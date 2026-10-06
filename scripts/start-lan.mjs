#!/usr/bin/env node
/**
 * Secure three-step LAN launcher:
 *   1. start this script;
 *   2. scan the terminal QR on the phone;
 *   3. tap the confirmation button.
 *
 * The helper deliberately binds dsh-remote to one private LAN IPv4 address,
 * creates a fresh 256-bit master token in memory, starts the pinned
 * @deepseek-ai/dsh@0.2.1-alpha.1 release on loopback, captures its upstream
 * launch token, and hands that token to the proxy as DSH_UPSTREAM_TOKEN.
 * It never accepts a public URL, wildcard listen address, or inherited TLS
 * configuration: use proxy/dsh-remote.mjs directly for advanced deployments.
 */
import crypto from 'node:crypto'
import dgram from 'node:dgram'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const DEFAULT_TARGET_PORT = 3080
const DEFAULT_LISTEN_PORT = 3081

/** The released Harness version this launcher is verified against. */
export const DSH_RELEASE = '@deepseek-ai/dsh@0.2.1-alpha.1'
const DSH_RELEASE_VERSION = DSH_RELEASE.slice(DSH_RELEASE.lastIndexOf('@') + 1)

export function isPrivateLanIPv4(address) {
  const octets = String(address).split('.').map((part) => Number(part))
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
}

export function parsePort(value, name) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`)
  }
  return port
}

function interfaceRank(name) {
  if (/^(en|eth|wl|wlan)/i.test(name) || /wi-?fi|ethernet/i.test(name)) return 0
  if (/^(utun|tun|tap|tailscale|docker|bridge|veth)/i.test(name)) return 2
  return 1
}

export function listPrivateLanIPv4(interfaces = os.networkInterfaces()) {
  return Object.entries(interfaces)
    .flatMap(([name, entries]) => (entries ?? [])
      .filter((entry) => (entry.family === 'IPv4' || entry.family === 4)
        && !entry.internal
        && isPrivateLanIPv4(entry.address))
      .map((entry) => ({ name, address: entry.address })))
    .sort((left, right) => interfaceRank(left.name) - interfaceRank(right.name)
      || left.name.localeCompare(right.name)
      || left.address.localeCompare(right.address))
}

function defaultRouteIPv4() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4')
    let settled = false
    const finish = (address) => {
      if (settled) return
      settled = true
      try { socket.close() } catch {}
      resolve(address)
    }
    socket.once('error', () => finish(undefined))
    socket.connect(9, '192.0.2.1', () => {
      const local = socket.address()
      finish(typeof local === 'object' ? local.address : undefined)
    })
    const timeout = setTimeout(() => finish(undefined), 500)
    timeout.unref()
  })
}

export async function choosePrivateLanIPv4(explicit = process.env.DSH_LAN_IP) {
  if (explicit !== undefined) {
    if (!isPrivateLanIPv4(explicit)) {
      throw new Error(`DSH_LAN_IP must be a private LAN IPv4 address, got ${explicit}`)
    }
    return explicit
  }

  const candidates = listPrivateLanIPv4()
  const routeAddress = await defaultRouteIPv4()
  if (routeAddress && candidates.some((candidate) => candidate.address === routeAddress)) {
    return routeAddress
  }
  if (candidates.length > 0) return candidates[0].address
  throw new Error('no private LAN IPv4 address found; connect to Wi-Fi/Ethernet or set DSH_LAN_IP')
}

/**
 * Resolve the exact Harness release to launch.
 *
 * An installed `dsh` is deliberately NOT preferred: its version is unknown and
 * the documented path must run the release this repo is verified against. The
 * default is npx pinned to DSH_RELEASE; an explicit DSH_BIN override is only
 * accepted after `--version` confirms the same release.
 */
export function resolveDshCommand(env = process.env) {
  if (env.DSH_BIN) {
    const probe = spawnSync(env.DSH_BIN, ['--version'], { encoding: 'utf8' })
    const reported = `${probe.stdout ?? ''}${probe.stderr ?? ''}`.trim()
    if (probe.status !== 0 || !reported.includes(DSH_RELEASE_VERSION)) {
      throw new Error(`DSH_BIN must be ${DSH_RELEASE}; got ${reported || 'no version output'}`)
    }
    return { command: env.DSH_BIN, args: [] }
  }
  return {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['--yes', DSH_RELEASE],
  }
}

/** Extract the upstream launch token from a `dsh web` output line. */
export function parseLaunchToken(text) {
  return /https?:\/\/\S+[?&]token=(\S+)/.exec(String(text))?.[1]
}

/** Environment for the LAN proxy: private LAN bind + upstream token handoff. */
export function buildProxyEnv(baseEnv, { masterToken, upstreamToken, lanIp, listenPort, targetPort }) {
  const proxyEnv = { ...baseEnv,
    DSH_REMOTE_TOKEN: masterToken,
    DSH_UPSTREAM_TOKEN: upstreamToken,
    DSH_LISTEN_HOST: lanIp,
    DSH_LISTEN_PORT: String(listenPort),
    DSH_TARGET_HOST: '127.0.0.1',
    DSH_TARGET_PORT: String(targetPort),
    DSH_PAIR_QR: 'on',
  }
  delete proxyEnv.DSH_PUBLIC_URL
  delete proxyEnv.DSH_TLS_CERT
  delete proxyEnv.DSH_TLS_KEY
  delete proxyEnv.DSH_LAUNCHER
  delete proxyEnv.NO_COLOR
  return proxyEnv
}

function waitForTcp(host, port, child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error ? reject(error) : resolve()
    }
    const timer = setTimeout(() => finish(new Error(`${host}:${port} did not become ready`)), timeoutMs)
    const attempt = () => {
      if (settled) return
      if (child.exitCode !== null) {
        finish(new Error(`child process exited before ${host}:${port} became ready`))
        return
      }
      const socket = net.createConnection({ host, port })
      let attemptDone = false
      const retry = () => {
        if (attemptDone || settled) return
        attemptDone = true
        socket.destroy()
        if (Date.now() >= deadline) finish(new Error(`${host}:${port} did not become ready`))
        else setTimeout(attempt, 200).unref()
      }
      socket.once('connect', () => {
        attemptDone = true
        socket.destroy()
        finish()
      })
      socket.once('error', retry)
      socket.setTimeout(300, retry)
    }
    attempt()
  })
}

async function portInUse(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(300, () => finish(false))
  })
}

async function waitForUpstream(port, child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('dsh web exited before becoming ready')
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(1_000),
      })
      await response.body?.cancel()
      return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`dsh web did not become ready on 127.0.0.1:${port}`)
}

/**
 * Mirror `dsh web` stdout while watching for its launch URL. The pinned release
 * prints `dsh web: <url>?token=...` on stdout; the token is what the proxy
 * exchanges for the upstream browser session (DSH_UPSTREAM_TOKEN).
 */
function watchForLaunchToken(stream, child, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    let pending = ''
    let settled = false
    const finish = (error, token) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stream.off('data', onData)
      error ? reject(error) : resolve(token)
    }
    const onData = (chunk) => {
      process.stdout.write(chunk)
      pending += chunk.toString('utf8')
      const token = parseLaunchToken(pending)
      if (token !== undefined) {
        finish(undefined, token)
        return
      }
      if (pending.length > 64 * 1024) pending = pending.slice(-4 * 1024)
    }
    const timer = setTimeout(() => finish(new Error('dsh did not print an upstream launch token')), timeoutMs)
    stream.on('data', onData)
    stream.once('end', () => finish(new Error('dsh stdout ended before printing an upstream launch token')))
    child.once('exit', () => finish(new Error('dsh exited before printing an upstream launch token')))
  })
}

function stop(child) {
  if (child && child.exitCode === null) child.kill('SIGTERM')
}

async function main() {
  if (process.env.DSH_PUBLIC_URL || process.env.DSH_TLS_CERT || process.env.DSH_TLS_KEY) {
    throw new Error('start-lan is LAN-only; remove DSH_PUBLIC_URL/DSH_TLS_CERT/DSH_TLS_KEY or use proxy/dsh-remote.mjs directly')
  }

  const targetPort = parsePort(process.env.DSH_TARGET_PORT ?? DEFAULT_TARGET_PORT, 'DSH_TARGET_PORT')
  const listenPort = parsePort(process.env.DSH_LISTEN_PORT ?? DEFAULT_LISTEN_PORT, 'DSH_LISTEN_PORT')
  const lanIp = await choosePrivateLanIPv4()
  if (await portInUse('127.0.0.1', targetPort)) {
    throw new Error(`127.0.0.1:${targetPort} is already in use; stop the existing dsh web or set DSH_TARGET_PORT`)
  }
  if (await portInUse(lanIp, listenPort)) {
    throw new Error(`${lanIp}:${listenPort} is already in use; stop the existing proxy or set DSH_LISTEN_PORT`)
  }

  const token = crypto.randomBytes(32).toString('hex')
  const dshCommand = resolveDshCommand()
  const viaNpx = dshCommand.command === 'npx' || dshCommand.command === 'npx.cmd'
  console.log(`start-lan: using private LAN address ${lanIp}`)
  console.log(`start-lan: starting dsh web on 127.0.0.1:${targetPort}`)
  console.log(viaNpx
    ? `start-lan: launching pinned ${DSH_RELEASE} via npx`
    : `start-lan: using verified ${DSH_RELEASE} at ${dshCommand.command}`)

  let host
  let proxy
  let stopping = false
  const cleanup = (code = 0) => {
    if (stopping) return
    stopping = true
    stop(proxy)
    stop(host)
    setTimeout(() => {
      stop(proxy)
      stop(host)
      process.exit(code)
    }, 1_500).unref()
  }
  process.once('SIGINT', () => cleanup(0))
  process.once('SIGTERM', () => cleanup(0))

  try {
    host = spawn(dshCommand.command, [...dshCommand.args, 'web', '--port', String(targetPort)], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    host.stderr.pipe(process.stderr)
    host.once('error', (error) => {
      if (!stopping) {
        console.error(`start-lan: failed to start dsh: ${error.message}`)
        cleanup(1)
      }
    })
    host.once('exit', (code, signal) => {
      if (!stopping) {
        console.error(`start-lan: dsh exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})`)
        cleanup(1)
      }
    })
    const upstreamToken = await watchForLaunchToken(host.stdout, host)
    await waitForUpstream(targetPort, host)
    console.log('start-lan: captured the upstream launch token; handing it to the proxy')

    const proxyEnv = buildProxyEnv(process.env, {
      masterToken: token,
      upstreamToken,
      lanIp,
      listenPort,
      targetPort,
    })

    proxy = spawn(process.execPath, [path.join(ROOT, 'proxy/dsh-remote.mjs')], {
      cwd: ROOT,
      env: proxyEnv,
      stdio: 'inherit',
    })
    proxy.once('error', (error) => {
      if (!stopping) {
        console.error(`start-lan: failed to start proxy: ${error.message}`)
        cleanup(1)
      }
    })
    proxy.once('exit', (code, signal) => {
      if (!stopping) {
        console.error(`start-lan: proxy exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})`)
        cleanup(1)
      }
    })
    await waitForTcp(lanIp, listenPort, proxy, 10_000)

    console.log('')
    console.log('start-lan: ready — exactly three steps:')
    console.log('  1. Keep the phone and computer on the same Wi-Fi.')
    console.log('  2. Scan the QR code printed above.')
    console.log('  3. Tap “确认配对并连接” once in the phone browser.')
    console.log('  The master token stays in this process and is never shown.')
    console.log('  Press Ctrl-C to stop both dsh web and the LAN proxy.')
    await new Promise(() => {})
  } catch (error) {
    cleanup(1)
    throw error
  }
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  main().catch((error) => {
    console.error(`start-lan: ${error.message}`)
    process.exitCode = 1
  })
}
