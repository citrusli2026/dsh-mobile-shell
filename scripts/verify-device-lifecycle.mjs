#!/usr/bin/env node
/**
 * Device lifecycle matrix for dsh-remote (roadmap W2 gate). Spawns its own
 * proxy instances on scratch ports with a scratch DSH_STATE_FILE, so it can
 * test boot-time fail-closed and restart persistence without touching a real
 * deployment. No upstream dsh required.
 *
 *   DSH_REMOTE_TOKEN=ci-test-token-123456 node scripts/verify-device-lifecycle.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const TOKEN = process.env.DSH_REMOTE_TOKEN
if (!TOKEN) {
  console.error('DSH_REMOTE_TOKEN is required')
  process.exit(2)
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lifecycle-'))
const STATE = path.join(scratch, 'devices.json')
const PROXY = `http://127.0.0.1:${4310 + (process.pid % 200)}`
const proxyPath = fileURLToPath(new URL('../proxy/dsh-remote.mjs', import.meta.url))

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

function startProxy() {
  const child = spawn(process.execPath, [proxyPath], {
    env: {
      ...process.env,
      DSH_REMOTE_TOKEN: TOKEN,
      DSH_LISTEN_PORT: String(new URL(PROXY).port),
      DSH_LISTEN_HOST: '127.0.0.1',
      DSH_STATE_FILE: STATE,
      DSH_LAUNCHER: fileURLToPath(new URL('../app/www/index.html', import.meta.url)),
      DSH_PAIR_QR: 'off',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.on('data', (chunk) => process.stderr.write(`[proxy] ${chunk}`))
  return child
}

async function waitHealthy() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`${PROXY}/healthz`)
      if (res.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('proxy did not become healthy')
}

function cookieOf(res) {
  const match = /(?:^|;\s*)dsh_token=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')
  expect(match, `device cookie missing: ${res.headers.get('set-cookie')}`)
  return match[1]
}

async function mintAndPair(name, client) {
  const mint = await fetch(`${PROXY}/pair/new`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
  })
  expect(mint.status === 200, `mint HTTP ${mint.status}`)
  const { code } = await mint.json()
  const pair = await fetch(`${PROXY}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(client ? { 'x-dsh-client': 'app' } : {}) },
    body: JSON.stringify({ code, name }),
  })
  expect(pair.status === 200, `pair HTTP ${pair.status}`)
  return cookieOf(pair)
}

let proxy = startProxy()

await check('boot with a fresh registry answers healthz', waitHealthy)

await check('device registry records the paired device with a name and timestamps', async () => {
  globalThis.deviceA = await mintAndPair('测试手机 Test Phone')
  const list = await fetch(`${PROXY}/devices`, { headers: { authorization: `Bearer ${TOKEN}` } })
  expect(list.status === 200, `devices HTTP ${list.status}`)
  const body = await list.json()
  expect(body.devices.length === 1, `expected 1 device: ${JSON.stringify(body)}`)
  const [record] = body.devices
  expect(record.name === '测试手机 Test Phone', `name lost: ${record.name}`)
  expect(record.active === true && record.revokedAt === null, 'device not active')
  expect(Number.isSafeInteger(record.issuedAt) && Number.isSafeInteger(record.expiresAt), 'timestamps missing')
  expect(record.expiresAt - record.issuedAt === 30 * 24 * 60 * 60 * 1000, `unexpected TTL: ${record.expiresAt - record.issuedAt}`)
})

await check('session check identifies the current device', async () => {
  const res = await fetch(`${PROXY}/session/check`, {
    headers: { cookie: `dsh_token=${deviceA}` },
  })
  expect(res.status === 200, `HTTP ${res.status}`)
  const body = await res.json()
  expect(body.authenticated === true && body.master === false, `unexpected body: ${JSON.stringify(body)}`)
  expect(body.deviceName === '测试手机 Test Phone', `name missing: ${JSON.stringify(body)}`)
  globalThis.deviceAId = body.deviceId
})

await check('session check rejects anonymous callers', async () => {
  const res = await fetch(`${PROXY}/session/check`)
  expect(res.status === 401, `HTTP ${res.status}`)
})

await check('device management surface is master-token only', async () => {
  const anon = await fetch(`${PROXY}/devices`)
  expect(anon.status === 401, `anon devices HTTP ${anon.status}`)
  const device = await fetch(`${PROXY}/devices`, { headers: { cookie: `dsh_token=${deviceA}` } })
  expect(device.status === 401, `device token listed devices: HTTP ${device.status}`)
  const revoke = await fetch(`${PROXY}/devices/revoke`, {
    method: 'POST',
    headers: { cookie: `dsh_token=${deviceA}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: deviceAId }),
  })
  expect(revoke.status === 401, `device token revoked: HTTP ${revoke.status}`)
})

await check('a second device pairs independently and stays unaffected', async () => {
  globalThis.deviceB = await mintAndPair('第二台设备')
  const checkB = await fetch(`${PROXY}/session/check`, { headers: { cookie: `dsh_token=${deviceB}` } })
  expect(checkB.status === 200, `B check HTTP ${checkB.status}`)
})

await check('revoking device A cuts it off; device B keeps working', async () => {
  const revoke = await fetch(`${PROXY}/devices/revoke`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: deviceAId }),
  })
  expect(revoke.status === 200, `revoke HTTP ${revoke.status}`)
  const dead = await fetch(`${PROXY}/session/check`, { headers: { cookie: `dsh_token=${deviceA}` } })
  expect(dead.status === 401, `revoked device still authenticated: HTTP ${dead.status}`)
  const alive = await fetch(`${PROXY}/session/check`, { headers: { cookie: `dsh_token=${deviceB}` } })
  expect(alive.status === 200, `sibling device lost access: HTTP ${alive.status}`)
})

await check('revocation is idempotent and unknown ids answer 200/revoked:false', async () => {
  for (const id of [deviceAId, '00000000-0000-4000-8000-000000000000']) {
    const res = await fetch(`${PROXY}/devices/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    expect(res.status === 200, `HTTP ${res.status}`)
    expect((await res.json()).revoked === false, `id ${id} reported revoked twice`)
  }
})

await check('logout revokes the presenting device and clears the cookie', async () => {
  const out = await fetch(`${PROXY}/device/logout`, {
    method: 'POST',
    headers: { cookie: `dsh_token=${deviceB}` },
  })
  expect(out.status === 200, `logout HTTP ${out.status}`)
  const cookie = out.headers.get('set-cookie') ?? ''
  expect(cookie.includes('Max-Age=0'), `cookie not cleared: ${cookie}`)
  const after = await fetch(`${PROXY}/session/check`, { headers: { cookie: `dsh_token=${deviceB}` } })
  expect(after.status === 401, `logged-out device still authenticated: HTTP ${after.status}`)
})

await check('logout is idempotent even with an already-invalid session', async () => {
  const out = await fetch(`${PROXY}/device/logout`, {
    method: 'POST',
    headers: { cookie: `dsh_token=${deviceB}` },
  })
  expect(out.status === 200, `second logout HTTP ${out.status}`)
  const anon = await fetch(`${PROXY}/device/logout`, { method: 'POST' })
  expect(anon.status === 200, `anonymous logout HTTP ${anon.status}`)
})

await check('tampered-but-unregistered token cannot resurrect via signature reuse', async () => {
  const fresh = await mintAndPair('短期设备')
  const [, payload] = fresh.split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  // Revoke it through the registry path, then re-present the still-valid signature.
  const list = await fetch(`${PROXY}/devices`, { headers: { authorization: `Bearer ${TOKEN}` } })
  const { devices } = await list.json()
  const record = devices.find((device) => device.name === '短期设备')
  await fetch(`${PROXY}/devices/revoke`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: record.id }),
  })
  const res = await fetch(`${PROXY}/session/check`, { headers: { cookie: `dsh_token=${fresh}` } })
  expect(res.status === 401, `revoked-by-registry token still valid: HTTP ${res.status}`)
  expect(claims.exp > Date.now(), 'test precondition broken: token already expired')
})

await check('expired-but-registered tokens fail closed', async () => {
  // Craft a registry entry with an expired device whose signature is valid.
  const id = '11111111-1111-4111-8111-111111111111'
  const payload = Buffer.from(JSON.stringify({ id, exp: Date.now() - 1000 })).toString('base64url')
  const signature = cryptoSign(payload)
  // Register it directly in the state file (as an old deployment would have).
  proxy.kill('SIGTERM')
  await new Promise((resolve) => proxy.on('exit', resolve))
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'))
  state.devices.push({
    id, name: '过期设备', issuedAt: Date.now() - 31 * 86400000,
    expiresAt: Date.now() - 1000, revokedAt: null, lastSeenAt: null,
  })
  fs.writeFileSync(STATE, JSON.stringify(state))
  proxy = startProxy()
  await waitHealthy()
  const res = await fetch(`${PROXY}/session/check`, { headers: { cookie: `dsh_token=dshd1.${payload}.${signature}` } })
  expect(res.status === 401, `expired token authenticated: HTTP ${res.status}`)
})

await check('registry persists across a proxy restart', async () => {
  const cookie = await mintAndPair('重启幸存者')
  proxy.kill('SIGTERM')
  await new Promise((resolve) => proxy.on('exit', resolve))
  proxy = startProxy()
  await waitHealthy()
  const res = await fetch(`${PROXY}/session/check`, { headers: { cookie: `dsh_token=${cookie}` } })
  expect(res.status === 200, `device lost after restart: HTTP ${res.status}`)
  const list = await fetch(`${PROXY}/devices`, { headers: { authorization: `Bearer ${TOKEN}` } })
  const { devices } = await list.json()
  expect(devices.some((device) => device.name === '重启幸存者'), 'record missing after restart')
  expect(devices.every((device) => device.expiresAt > Date.now() || device.revokedAt), 'expired records were not pruned on list')
})

await check('state file is 0600 and never contains a bearer secret', async () => {
  const mode = fs.statSync(STATE).mode & 0o777
  expect(mode === 0o600, `state file mode is ${mode.toString(8)}`)
  const raw = fs.readFileSync(STATE, 'utf8')
  expect(!raw.includes('dshd1.'), 'state file contains a bearer token')
  expect(!raw.includes(TOKEN), 'state file contains the master token')
})

await check('pairing QR SVG is master-gated and self-contained', async () => {
  const anon = await fetch(`${PROXY}/pair/qr.svg`)
  expect(anon.status === 401, `anon QR HTTP ${anon.status}`)
  const res = await fetch(`${PROXY}/pair/qr.svg`, { headers: { authorization: `Bearer ${TOKEN}` } })
  expect(res.status === 200, `QR HTTP ${res.status}`)
  expect((res.headers.get('content-type') ?? '').includes('image/svg+xml'), 'not SVG')
  expect((res.headers.get('cache-control') ?? '').includes('no-store'), 'QR is cacheable')
  const svg = await res.text()
  expect(svg.startsWith('<svg'), 'SVG body malformed')
  expect(!svg.includes(TOKEN), 'QR SVG leaked the master token')
})

await check('corrupt state file fails closed at boot', async () => {
  proxy.kill('SIGTERM')
  await new Promise((resolve) => proxy.on('exit', resolve))
  fs.writeFileSync(STATE, '{not json')
  const child = startProxy()
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c)))
  expect(code !== 0, `corrupt state booted anyway (exit ${code})`)
  expect(stderr.includes('corrupt'), `no fail-closed message: ${stderr}`)
  // Unsupported version also fails closed.
  fs.writeFileSync(STATE, JSON.stringify({ version: 99, devices: [] }))
  const child2 = startProxy()
  const code2 = await new Promise((resolve) => child2.on('exit', (c) => resolve(c)))
  expect(code2 !== 0, `unsupported state version booted anyway (exit ${code2})`)
})

await check('deleting the state file revokes every device (documented recovery)', async () => {
  fs.rmSync(STATE, { force: true })
  proxy = startProxy()
  await waitHealthy()
  const list = await fetch(`${PROXY}/devices`, { headers: { authorization: `Bearer ${TOKEN}` } })
  expect(((await list.json()).devices.length) === 0, 'devices survived registry deletion')
})

proxy.kill('SIGTERM')
fs.rmSync(scratch, { recursive: true, force: true })

import crypto from 'node:crypto'
function cryptoSign(payload) {
  return crypto.createHmac('sha256', TOKEN).update(payload).digest('base64url')
}

if (failures > 0) {
  console.error(`\n${failures} case(s) failed`)
  process.exit(1)
}
console.log('\nall device lifecycle cases passed')
