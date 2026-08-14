#!/usr/bin/env node
/**
 * Smoke matrix for dsh-remote (proxy/dsh-remote.mjs). Asserts the token gate
 * and the upstream-fence interop without any test framework — exits non-zero
 * on the first failure, prints one line per case. Used by CI
 * (.github/workflows/verify-proxy.yml) and runnable locally:
 *
 *   dsh web --port 3080 &
 *   DSH_REMOTE_TOKEN=ci-test-token-123456 node proxy/dsh-remote.mjs &
 *   DSH_REMOTE_TOKEN=ci-test-token-123456 node scripts/verify-proxy.mjs
 *
 * Env: PROXY_URL (default http://127.0.0.1:3081), UPSTREAM_URL (default
 * http://127.0.0.1:3080), DSH_REMOTE_TOKEN (required).
 */
import net from 'node:net'
import tls from 'node:tls'

const PROXY = process.env.PROXY_URL ?? 'http://127.0.0.1:3081'
const UPSTREAM = process.env.UPSTREAM_URL ?? 'http://127.0.0.1:3080'
const TOKEN = process.env.DSH_REMOTE_TOKEN
if (!TOKEN) {
  console.error('DSH_REMOTE_TOKEN is required')
  process.exit(2)
}
// Self-signed test certs (CI TLS variant): DSH_VERIFY_INSECURE_TLS=1 disables
// chain verification for this process only. Never set this against real hosts.
if (process.env.DSH_VERIFY_INSECURE_TLS === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  console.log('note: TLS verification disabled (DSH_VERIFY_INSECURE_TLS=1)')
}
const SECURE = PROXY.startsWith('https:')

let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL ${name}: ${error.message}`)
  }
}
function expect(cond, message) {
  if (!cond) throw new Error(message)
}

/** Minimal WS handshake over a raw socket; resolves the HTTP status line code. */
function wsHandshakeStatus(url, headers) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const onConnect = (socket) => {
      const lines = Object.entries({
        host: target.host,
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...headers,
      }).map(([k, v]) => `${k}: ${v}`).join('\r\n')
      socket.write(`GET ${target.pathname} HTTP/1.1\r\n${lines}\r\n\r\n`)
      let data = ''
      socket.on('data', (chunk) => {
        data += chunk
        const match = /^HTTP\/1\.1 (\d+)/.exec(data)
        if (match) {
          socket.destroy()
          resolve(Number(match[1]))
        }
      })
      socket.on('error', reject)
      socket.setTimeout(8000, () => {
        socket.destroy()
        reject(new Error('ws handshake timeout'))
      })
    }
    if (SECURE) {
      onConnect(tls.connect(Number(target.port), target.hostname, { rejectUnauthorized: false }))
    } else {
      onConnect(net.connect(Number(target.port), target.hostname))
    }
  })
}

await check('upstream dsh web is reachable', async () => {
  const res = await fetch(`${UPSTREAM}/`)
  expect(res.ok, `HTTP ${res.status} from ${UPSTREAM}/ — is \`dsh web\` running?`)
})

await check('healthz answers 200 with CORS * without a token', async () => {
  const res = await fetch(`${PROXY}/healthz`)
  expect(res.status === 200, `HTTP ${res.status}`)
  expect(res.headers.get('access-control-allow-origin') === '*', 'missing ACAO:*')
})

await check('GET / without token → 401', async () => {
  const res = await fetch(`${PROXY}/`, { redirect: 'manual' })
  expect(res.status === 401, `HTTP ${res.status}`)
})

await check('GET / with a wrong token → 401', async () => {
  const res = await fetch(`${PROXY}/?token=wrong-token-value`, { redirect: 'manual' })
  expect(res.status === 401, `HTTP ${res.status}`)
})

await check('login with the right token → 302 + HttpOnly cookie', async () => {
  const res = await fetch(`${PROXY}/?token=${encodeURIComponent(TOKEN)}`, { redirect: 'manual' })
  expect(res.status === 302, `HTTP ${res.status}`)
  const cookie = res.headers.get('set-cookie') ?? ''
  expect(cookie.includes('dsh_token=') && cookie.includes('HttpOnly'), `set-cookie: ${cookie}`)
})

const session = { cookie: `dsh_token=${TOKEN}` }

await check('GET / with session cookie → the real dsh web UI', async () => {
  const res = await fetch(`${PROXY}/`, { headers: session })
  expect(res.status === 200, `HTTP ${res.status}`)
  expect((await res.text()).includes('DeepSeek Harness'), 'title marker missing')
})

await check('POST /api without cookie → 401', async () => {
  const res = await fetch(`${PROXY}/api/rpc/connection/ping`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  expect(res.status === 401, `HTTP ${res.status}`)
})

await check('authenticated /api POST passes the upstream fence (not 401/403)', async () => {
  const res = await fetch(`${PROXY}/api/rpc/connection/ping`, {
    method: 'POST',
    headers: { ...session, 'content-type': 'application/json', origin: PROXY },
    body: '{"type":"client-request","rpcId":"1","method":"ping","payload":{}}',
  })
  expect(res.status !== 401 && res.status !== 403, `HTTP ${res.status} — trust fence rejected`)
})

await check('WS handshake without token → 403', async () => {
  const status = await wsHandshakeStatus(`${PROXY}/api/events.mux`, {})
  expect(status === 403, `HTTP ${status}`)
})

await check('WS handshake with cookie → 101', async () => {
  const status = await wsHandshakeStatus(`${PROXY}/api/events.mux`, session)
  expect(status === 101, `HTTP ${status}`)
})

// ── pairing (ADR-0006) ───────────────────────────────────────────────────

await check('POST /pair/new without master token → 401', async () => {
  const res = await fetch(`${PROXY}/pair/new`, { method: 'POST' })
  expect(res.status === 401, `HTTP ${res.status}`)
})

let mintedCode = ''
await check('POST /pair/new with master token → 6-digit code', async () => {
  const res = await fetch(`${PROXY}/pair/new`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
  })
  expect(res.status === 200, `HTTP ${res.status}`)
  const body = await res.json()
  expect(/^\d{6}$/.test(body.code ?? ''), `code shape: ${JSON.stringify(body)}`)
  mintedCode = body.code
})

await check('OPTIONS /pair → 204 with CORS allow headers', async () => {
  const res = await fetch(`${PROXY}/pair`, { method: 'OPTIONS' })
  expect(res.status === 204, `HTTP ${res.status}`)
  expect(res.headers.get('access-control-allow-origin') === '*', 'missing ACAO:*')
})

await check('POST /pair with a wrong code → 403', async () => {
  const wrong = mintedCode === '999999' ? '888888' : '999999'
  const res = await fetch(`${PROXY}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: wrong }),
  })
  expect(res.status === 403, `HTTP ${res.status}`)
})

await check('POST /pair with the minted code → the master token', async () => {
  const res = await fetch(`${PROXY}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: mintedCode }),
  })
  expect(res.status === 200, `HTTP ${res.status}`)
  const body = await res.json()
  expect(body.token === TOKEN, 'returned token mismatch')
})

await check('redeemed code is single-use (replay → 403)', async () => {
  const res = await fetch(`${PROXY}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: mintedCode }),
  })
  expect(res.status === 403, `HTTP ${res.status}`)
})

await check('pairing attempts are rate-limited (burst → 429)', async () => {
  let saw429 = false
  for (let i = 0; i < 12; i += 1) {
    const res = await fetch(`${PROXY}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '000000' }),
    })
    if (res.status === 429) saw429 = true
  }
  expect(saw429, 'no 429 after a 12-attempt burst')
})

if (failures > 0) {
  console.error(`\n${failures} case(s) failed`)
  process.exit(1)
}
console.log('\nall cases passed')
