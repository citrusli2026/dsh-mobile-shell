#!/usr/bin/env node
/**
 * Launcher checks for scripts/start-lan.mjs.
 *
 * Always-on: address/port helpers plus the pinning and handoff contract —
 * exact release selection, upstream launch-token capture, and the proxy
 * environment that carries the token to the LAN proxy.
 *
 * Live integration (DSH_START_LAN_LIVE=1; used by .github/workflows/
 * verify-proxy.yml): boots the real launcher against the pinned published
 * release and proves paired UI / authenticated API / WebSocket access through
 * the launcher's own proxy. It is skipped, with an explicit note, when the
 * machine exposes no private LAN IPv4 address.
 */
import net from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  DSH_RELEASE,
  buildProxyEnv,
  choosePrivateLanIPv4,
  isPrivateLanIPv4,
  launchTokenTimeoutMs,
  listPrivateLanIPv4,
  parseLaunchToken,
  parsePort,
  resolveDshCommand,
} from './start-lan.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

// ── LAN binding restrictions (unchanged) ────────────────────────────────
expect(isPrivateLanIPv4('192.168.1.23'), '192.168/16 should be accepted')
expect(isPrivateLanIPv4('10.0.0.7'), '10/8 should be accepted')
expect(isPrivateLanIPv4('172.20.0.4'), '172.16/12 should be accepted')
expect(!isPrivateLanIPv4('8.8.8.8'), 'public IPv4 should be rejected')
expect(!isPrivateLanIPv4('172.32.0.4'), '172.32/12 boundary should be rejected')

const interfaces = {
  en0: [
    { address: '192.168.1.23', family: 'IPv4', internal: false },
    { address: 'fe80::1', family: 'IPv6', internal: false },
  ],
  utun0: [{ address: '10.8.0.2', family: 'IPv4', internal: false }],
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
}
const candidates = listPrivateLanIPv4(interfaces)
expect(candidates.map((entry) => entry.address).join(',') === '192.168.1.23,10.8.0.2',
  `unexpected LAN candidates: ${JSON.stringify(candidates)}`)
expect(await choosePrivateLanIPv4('192.168.1.23') === '192.168.1.23',
  'explicit private LAN address should be accepted')

let rejected = false
try {
  await choosePrivateLanIPv4('203.0.113.4')
} catch {
  rejected = true
}
expect(rejected, 'explicit public address should be rejected')
expect(parsePort('3081', 'PORT') === 3081, 'valid port should parse')

// ── exact release selection ─────────────────────────────────────────────
expect(DSH_RELEASE === '@deepseek-ai/dsh@0.2.1-alpha.1',
  `launcher release pin drifted: ${DSH_RELEASE}`)
const pinned = resolveDshCommand({})
expect(pinned.command === 'npx' || pinned.command === 'npx.cmd',
  `default launcher must use npx, got ${pinned.command}`)
expect(pinned.args.join(' ') === `--yes ${DSH_RELEASE}`,
  `default launcher args are not the pinned release: ${JSON.stringify(pinned.args)}`)
let rejectedBin = false
try {
  resolveDshCommand({ DSH_BIN: process.execPath })
} catch {
  rejectedBin = true
}
expect(rejectedBin, 'DSH_BIN with a mismatched version must be rejected')
console.log('ok   launcher selects exactly the pinned release')

// ── upstream launch-token capture ───────────────────────────────────────
const upstreamToken = 'upstream-token_ABC-123'
expect(parseLaunchToken(`dsh web: http://127.0.0.1:3080/?token=${upstreamToken}\n`) === upstreamToken,
  'private-bind launch line was not parsed')
expect(parseLaunchToken(`dsh web: http://192.168.1.23:3081/?token=${upstreamToken}\n`) === upstreamToken,
  'public-url launch line was not parsed')
expect(parseLaunchToken('dsh web: no token here\n') === undefined, 'tokenless output must not parse')
console.log('ok   upstream launch token is captured from dsh web output')

// ── token handoff + LAN-only proxy environment ──────────────────────────
const proxyEnv = buildProxyEnv({
  PATH: '/usr/bin',
  DSH_PUBLIC_URL: 'https://public.example',
  DSH_TLS_CERT: '/tmp/cert.pem',
  DSH_TLS_KEY: '/tmp/key.pem',
  DSH_LAUNCHER: '/tmp/launcher.html',
  NO_COLOR: '1',
}, {
  masterToken: 'master-token',
  upstreamToken,
  lanIp: '192.168.1.23',
  listenPort: 3081,
  targetPort: 3080,
})
expect(proxyEnv.DSH_UPSTREAM_TOKEN === upstreamToken, 'upstream token was not handed to the proxy')
expect(proxyEnv.DSH_REMOTE_TOKEN === 'master-token', 'master token was not handed to the proxy')
expect(proxyEnv.DSH_LISTEN_HOST === '192.168.1.23', 'proxy must bind the private LAN address')
expect(proxyEnv.DSH_LISTEN_PORT === '3081' && proxyEnv.DSH_TARGET_PORT === '3080',
  'proxy ports were not handed off')
expect(proxyEnv.DSH_TARGET_HOST === '127.0.0.1', 'upstream must stay on loopback')
expect(proxyEnv.DSH_PUBLIC_URL === undefined && proxyEnv.DSH_TLS_CERT === undefined
  && proxyEnv.DSH_TLS_KEY === undefined && proxyEnv.DSH_LAUNCHER === undefined
  && proxyEnv.NO_COLOR === undefined,
  'inherited public/TLS/launcher configuration leaked into the proxy environment')
console.log('ok   proxy receives the upstream token and LAN-only bind configuration')

if (process.env.DSH_START_LAN_LIVE !== '1') {
  console.log('skip launcher integration (set DSH_START_LAN_LIVE=1 to run it)')
  console.log('\nall secure LAN launcher checks passed')
  process.exit(0)
}

// ── live integration against the pinned published release ───────────────

function findPrivateLanIPv4() {
  if (process.env.DSH_LAN_IP) {
    expect(isPrivateLanIPv4(process.env.DSH_LAN_IP), `DSH_LAN_IP must be private: ${process.env.DSH_LAN_IP}`)
    return process.env.DSH_LAN_IP
  }
  try {
    return listPrivateLanIPv4()[0]?.address
  } catch {
    return undefined
  }
}

function waitForOutput(child, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error ? reject(error) : resolve(result)
    }
    const onData = (chunk) => {
      process.stdout.write(chunk)
      buffer += chunk.toString('utf8')
      const match = pattern.exec(buffer)
      if (match) {
        // Resolve both the match and the whole output seen so far: callers
        // assert on launcher announcements that precede this match.
        finish(undefined, { match, output: buffer })
        return
      }
      if (buffer.length > 128 * 1024) buffer = buffer.slice(-8 * 1024)
    }
    const timer = setTimeout(
      () => finish(new Error(`launcher output did not match ${pattern} in ${timeoutMs}ms`)),
      timeoutMs,
    )
    child.stdout.on('data', onData)
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    child.once('exit', (code) => finish(new Error(`launcher exited early (code=${code ?? 'null'})`)))
  })
}

function portListening(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, host)
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(400, () => finish(false))
  })
}

/**
 * R3: after the launcher is stopped, neither the DSH host (target port) nor
 * the proxy (listen port) may keep listening. `npx` runs the host as a
 * grandchild, so this asserts the launcher tears down its whole process tree.
 */
async function waitForPortsFree(pairs, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const busy = []
    for (const [host, port] of pairs) {
      if (await portListening(host, port)) busy.push(`${host}:${port}`)
    }
    if (busy.length === 0) return
    if (Date.now() >= deadline) {
      throw new Error(`launcher shutdown left listeners behind: ${busy.join(', ')}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

function wsHandshakeStatus(host, port, headers) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host)
    socket.on('connect', () => {
      const lines = Object.entries({
        host: `${host}:${port}`,
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...headers,
      }).map(([key, value]) => `${key}: ${value}`).join('\r\n')
      socket.write(`GET /api/remote.mux HTTP/1.1\r\n${lines}\r\n\r\n`)
    })
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
  })
}

const lanIp = findPrivateLanIPv4()
if (lanIp === undefined) {
  console.log('skip launcher integration: no private LAN IPv4 address available')
  console.log('\nall secure LAN launcher checks passed')
  process.exit(0)
}

const targetPort = Number(process.env.DSH_START_LAN_TARGET_PORT ?? 34080)
const listenPort = Number(process.env.DSH_START_LAN_LISTEN_PORT ?? 34081)
// The launcher waits for the pinned release's launch token; a cold npm cache
// has to download the release first, so the harness budget must exceed the
// launcher's own token budget plus time for npm/npx startup and pairing.
const launcherBudgetMs = launchTokenTimeoutMs(process.env) + 120_000
const workdir = mkdtempSync(path.join(tmpdir(), 'dsh-start-lan-'))
const launcher = spawn(process.execPath, [path.join(repoRoot, 'scripts/start-lan.mjs')], {
  cwd: repoRoot,
  env: { ...process.env,
    DSH_LAN_IP: lanIp,
    DSH_TARGET_PORT: String(targetPort),
    DSH_LISTEN_PORT: String(listenPort),
    DSH_STATE_FILE: path.join(workdir, 'devices.json'),
    DSH_PAIR_QR: 'off',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

try {
  const ready = await waitForOutput(launcher, /pairing link https?:\/\/[^\s#]*#pair=(\d{6})/, launcherBudgetMs)
  const pairingCode = ready.match[1]
  expect(ready.output.includes(DSH_RELEASE), 'launcher did not announce the pinned release')
  console.log(`ok   launcher started the pinned ${DSH_RELEASE} and announced a pairing code`)

  const base = `http://${lanIp}:${listenPort}`
  const pair = await fetch(`${base}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: pairingCode }),
  })
  expect(pair.status === 200, `pairing HTTP ${pair.status}`)
  const deviceCookie = /(?:^|;\s*)dsh_token=([^;]+)/.exec(pair.headers.get('set-cookie') ?? '')?.[1]
  expect(deviceCookie, 'pairing did not return a device session cookie')
  console.log('ok   paired with the launcher-issued code')

  const ui = await fetch(`${base}/`, { headers: { cookie: `dsh_token=${deviceCookie}` } })
  expect(ui.status === 200, `paired UI HTTP ${ui.status}`)
  const html = await ui.text()
  expect(html.includes('DeepSeek Harness'), 'paired UI is not the real Harness index')
  console.log('ok   paired UI loads the real Harness index through the launcher proxy')

  const envelope = {
    type: 'client-request',
    rpcId: 'start-lan-live-1',
    method: 'settings/describe',
    payload: { args: {} },
  }
  const api = await fetch(`${base}/api/settings/describe`, {
    method: 'POST',
    headers: { cookie: `dsh_token=${deviceCookie}`, 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
  })
  expect(api.status === 200, `authenticated API HTTP ${api.status}`)
  const apiBody = await api.json()
  expect(apiBody.result?.ok === true,
    `authenticated API failed: ${JSON.stringify(apiBody.result?.error ?? apiBody).slice(0, 200)}`)
  expect(Array.isArray(apiBody.result.value?.namespaces) && apiBody.result.value.namespaces.length > 0,
    'authenticated API returned no settings namespaces')
  console.log('ok   authenticated API returns a successful release-valid payload')

  const ws = await wsHandshakeStatus(lanIp, listenPort, { cookie: `dsh_token=${deviceCookie}` })
  expect(ws === 101, `paired WS handshake HTTP ${ws}`)
  console.log('ok   paired WebSocket handshake upgrades through the launcher proxy')
} finally {
  if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGTERM')
  await new Promise((resolve) => {
    if (launcher.exitCode !== null || launcher.signalCode !== null) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, 10_000)
    launcher.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
  rmSync(workdir, { recursive: true, force: true })
  // R3 evidence: the launcher must not leave the DSH host on the target port
  // (it is a grandchild through npx) or the proxy on the LAN listen port.
  await waitForPortsFree([['127.0.0.1', targetPort], [lanIp, listenPort]], 10_000)
  console.log('ok   launcher shutdown released the DSH host and proxy ports')
}

console.log('\nall secure LAN launcher checks passed')
