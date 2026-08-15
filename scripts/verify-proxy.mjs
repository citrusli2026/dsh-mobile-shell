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

/** Send a raw HTTP request so malformed Host handling can be regression-tested. */
function rawHttpStatus(url, request) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const onConnect = (socket) => {
      socket.write(request)
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
        reject(new Error('raw HTTP timeout'))
      })
    }
    if (SECURE) onConnect(tls.connect(Number(target.port), target.hostname, { rejectUnauthorized: false }))
    else onConnect(net.connect(Number(target.port), target.hostname))
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

await check('GET / without token → launcher page (web mode, ADR-0007)', async () => {
  const res = await fetch(`${PROXY}/`, { redirect: 'manual' })
  expect(res.status === 200, `HTTP ${res.status}`)
  expect((await res.text()).includes('dsh-remote launcher'), 'launcher marker missing')
  expect(res.headers.get('content-security-policy')?.includes("default-src 'none'"), 'launcher CSP missing')
  expect(res.headers.get('content-security-policy')?.includes("connect-src 'self'"), 'launcher connect-src is not same-origin')
  expect(res.headers.get('referrer-policy') === 'no-referrer', 'launcher referrer policy missing')
})

await check('malformed Host → 400 and proxy remains alive', async () => {
  const malformedHost = await rawHttpStatus(PROXY, 'GET / HTTP/1.1\r\nHost: [\r\nConnection: close\r\n\r\n')
  expect(malformedHost === 400, `malformed Host HTTP ${malformedHost}`)
  const userInfoHost = await rawHttpStatus(PROXY, 'GET / HTTP/1.1\r\nHost: user@127.0.0.1\r\nConnection: close\r\n\r\n')
  expect(userInfoHost === 400, `userinfo Host HTTP ${userInfoHost}`)
  const absoluteTarget = await rawHttpStatus(PROXY, `GET http://attacker.invalid/ HTTP/1.1\r\nHost: ${new URL(PROXY).host}\r\nConnection: close\r\n\r\n`)
  expect(absoluteTarget === 400, `absolute request target HTTP ${absoluteTarget}`)
  const health = await fetch(`${PROXY}/healthz`)
  expect(health.status === 200, `proxy died after malformed Host: HTTP ${health.status}`)
})

await check('GET / with a wrong token → launcher page (not the UI)', async () => {
  const res = await fetch(`${PROXY}/?token=wrong-token-value`, { redirect: 'manual' })
  expect(res.status === 200, `HTTP ${res.status}`)
  expect((await res.text()).includes('dsh-remote launcher'), 'launcher marker missing')
})

await check('GET /launch without token → launcher page', async () => {
  const res = await fetch(`${PROXY}/launch`, { redirect: 'manual' })
  expect(res.status === 200, `HTTP ${res.status}`)
  expect((await res.text()).includes('dsh-remote launcher'), 'launcher marker missing')
})

const session = { cookie: '' }
await check('login with the right token → 302 + down-scoped HttpOnly cookie', async () => {
  const res = await fetch(`${PROXY}/?token=${encodeURIComponent(TOKEN)}`, { redirect: 'manual' })
  expect(res.status === 302, `HTTP ${res.status}`)
  const cookie = res.headers.get('set-cookie') ?? ''
  expect(cookie.includes('dsh_token=') && cookie.includes('HttpOnly'), `set-cookie: ${cookie}`)
  expect(!cookie.includes(`dsh_token=${TOKEN};`), 'master token was persisted in the browser cookie')
  session.cookie = cookie.split(';', 1)[0]
  expect(session.cookie.startsWith('dsh_token=dshd1.'), `unexpected session cookie: ${session.cookie}`)
})

await check('GET / with session cookie → the real dsh web UI', async () => {
  const res = await fetch(`${PROXY}/`, { headers: session })
  expect(res.status === 200, `HTTP ${res.status}`)
  const html = await res.text()
  expect(html.includes('DeepSeek Harness'), 'title marker missing')
  expect(html.includes('data-dsh-remote-random-uuid-polyfill'), 'LAN crypto.randomUUID compatibility shim missing')
  expect(html.includes('getRandomValues'), 'UUID shim does not use Web Crypto randomness')
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
  if (!SECURE) {
    const frontedOrigin = new URL(PROXY)
    frontedOrigin.protocol = 'https:'
    const behindTlsTerminator = await fetch(`${PROXY}/api/rpc/connection/ping`, {
      method: 'POST',
      headers: { ...session, 'content-type': 'application/json', origin: frontedOrigin.origin },
      body: '{"type":"client-request","rpcId":"2","method":"ping","payload":{}}',
    })
    expect(behindTlsTerminator.status !== 401 && behindTlsTerminator.status !== 403,
      `HTTP ${behindTlsTerminator.status} — TLS-terminating front proxy was rejected`)
  }
})

await check('authenticated cross-origin API request → 403', async () => {
  const res = await fetch(`${PROXY}/api/rpc/connection/ping`, {
    method: 'POST',
    headers: { ...session, 'content-type': 'application/json', origin: 'https://attacker.invalid' },
    body: '{}',
  })
  expect(res.status === 403, `HTTP ${res.status}`)
})

await check('WS handshake without token → 403', async () => {
  const status = await wsHandshakeStatus(`${PROXY}/api/events.mux`, {})
  expect(status === 403, `HTTP ${status}`)
})

await check('WS handshake with cookie → 101', async () => {
  const status = await wsHandshakeStatus(`${PROXY}/api/events.mux`, session)
  expect(status === 101, `HTTP ${status}`)
})

await check('cross-origin WS handshake with cookie → 403', async () => {
  const status = await wsHandshakeStatus(`${PROXY}/api/events.mux`, {
    ...session,
    origin: 'https://attacker.invalid',
  })
  expect(status === 403, `HTTP ${status}`)
})

await check('malformed Host WS handshake → 400 and proxy remains alive', async () => {
  const status = await wsHandshakeStatus(`${PROXY}/api/events.mux`, { host: '[' })
  expect(status === 400, `HTTP ${status}`)
  const health = await fetch(`${PROXY}/healthz`)
  expect(health.status === 200, `proxy died after malformed WS Host: HTTP ${health.status}`)
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
  expect(Array.isArray(body.pairingUrls) && body.pairingUrls.length > 0,
    `pairing URLs missing: ${JSON.stringify(body)}`)
  const pairingUrl = new URL(body.pairingUrls[0])
  expect(pairingUrl.pathname === '/launch', `pairing path: ${pairingUrl.pathname}`)
  expect(pairingUrl.hash === `#pair=${body.code}`, `pairing fragment: ${pairingUrl.hash}`)
  expect(!body.pairingUrls[0].includes('token'), 'pairing URL leaked a token')
  mintedCode = body.code
})

await check('OPTIONS /pair → 204 with CORS allow headers', async () => {
  const res = await fetch(`${PROXY}/pair`, { method: 'OPTIONS' })
  expect(res.status === 204, `HTTP ${res.status}`)
  expect(res.headers.get('access-control-allow-origin') === '*', 'missing ACAO:*')
})

await check('oversized JSON body → 413 and proxy remains alive', async () => {
  const res = await fetch(`${PROXY}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'x'.repeat(70 * 1024) }),
  })
  expect(res.status === 413, `HTTP ${res.status}`)
  const health = await fetch(`${PROXY}/healthz`)
  expect(health.status === 200, `proxy died after oversized body: HTTP ${health.status}`)
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

let deviceToken = ''
await check('web pairing → HttpOnly device cookie; master token is not returned', async () => {
  const res = await fetch(`${PROXY}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: mintedCode }),
  })
  expect(res.status === 200, `HTTP ${res.status}`)
  const body = await res.json()
  expect(body.ok === true && body.token === undefined, `unexpected body: ${JSON.stringify(body)}`)
  const cookie = res.headers.get('set-cookie') ?? ''
  const match = /(?:^|;\s*)dsh_token=([^;]+)/.exec(cookie)
  expect(match, `device cookie missing: ${cookie}`)
  deviceToken = match[1]
  expect(deviceToken !== TOKEN, 'master token leaked into device cookie')
  expect(deviceToken.startsWith('dshd1.'), `unexpected device token shape: ${deviceToken}`)
  expect(cookie.includes('HttpOnly'), `cookie is not HttpOnly: ${cookie}`)
})

await check('device cookie can access UI but cannot mint pairing codes', async () => {
  const deviceSession = { cookie: `dsh_token=${deviceToken}` }
  const ui = await fetch(`${PROXY}/`, { headers: deviceSession })
  expect(ui.status === 200, `UI HTTP ${ui.status}`)
  expect((await ui.text()).includes('DeepSeek Harness'), 'device cookie did not reach real UI')
  const mint = await fetch(`${PROXY}/pair/new`, { method: 'POST', headers: deviceSession })
  expect(mint.status === 401, `device token minted a pairing code: HTTP ${mint.status}`)
})

await check('tampered device token → 401', async () => {
  const [prefix, payload, signature] = deviceToken.split('.')
  const tamperedSignature = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1)
  const tampered = `${prefix}.${payload}.${tamperedSignature}`
  const res = await fetch(`${PROXY}/api/rpc/connection/ping`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tampered}`, 'content-type': 'application/json' },
    body: '{}',
  })
  expect(res.status === 401, `HTTP ${res.status}`)
})

await check('POST /session accepts a device token and returns only a cookie', async () => {
  const res = await fetch(`${PROXY}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: deviceToken }),
  })
  expect(res.status === 200, `HTTP ${res.status}`)
  const body = await res.json()
  expect(body.ok === true && body.token === undefined, `unexpected body: ${JSON.stringify(body)}`)
  expect((res.headers.get('set-cookie') ?? '').includes('HttpOnly'), 'session cookie missing')
})

await check('POST /session down-scopes a master token and rejects cross-origin use', async () => {
  const res = await fetch(`${PROXY}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: TOKEN }),
  })
  expect(res.status === 200, `HTTP ${res.status}`)
  const cookie = res.headers.get('set-cookie') ?? ''
  expect(cookie.includes('dsh_token=dshd1.'), `master was not down-scoped: ${cookie}`)
  expect(!cookie.includes(`dsh_token=${TOKEN};`), 'master token was persisted')

  const crossOrigin = await fetch(`${PROXY}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://attacker.invalid' },
    body: JSON.stringify({ token: TOKEN }),
  })
  expect(crossOrigin.status === 403, `cross-origin HTTP ${crossOrigin.status}`)
})

await check('redeemed code is single-use (replay → 403)', async () => {
  const res = await fetch(`${PROXY}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: mintedCode }),
  })
  expect(res.status === 403, `HTTP ${res.status}`)
})

let appCode = ''
await check('app compatibility pairing returns a scoped device token, never the master', async () => {
  const mint = await fetch(`${PROXY}/pair/new`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
  })
  expect(mint.status === 200, `mint HTTP ${mint.status}`)
  appCode = (await mint.json()).code
  const res = await fetch(`${PROXY}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-client': 'app' },
    body: JSON.stringify({ code: appCode }),
  })
  expect(res.status === 200, `pair HTTP ${res.status}`)
  const body = await res.json()
  expect(typeof body.token === 'string' && body.token.startsWith('dshd1.'), 'device token missing')
  expect(body.token !== TOKEN, 'master token returned to app')
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
