#!/usr/bin/env node
/**
 * dsh-remote — token-guard reverse proxy for `dsh web` (mobile/LAN access).
 *
 * DeepSeek Harness intentionally refuses `--host 0.0.0.0` (remote code
 * execution exposure) and ships no auth layer. This proxy is the mobile
 * edition's answer: `dsh web` stays bound to loopback, and dsh-remote owns
 * network reachability plus a bearer-token gate in front of every forwarded
 * request, HTTP and WebSocket alike.
 *
 * Token presentation (any one of):
 *   1. `GET <any-path>?token=<t>` — login: validates, sets an HttpOnly
 *      `dsh_token` cookie and 302-redirects to the same URL without the
 *      token query (mobile launcher uses this; browsers then send the
 *      cookie on every same-origin request, including WS handshakes).
 *   2. `Cookie: dsh_token=<t>` — session requests after login.
 *   3. `Authorization: Bearer <t>` — non-browser clients.
 *
 * `GET /healthz` answers 200 without auth (with `Access-Control-Allow-
 * Origin: *`) so the app launcher can precheck reachability from its own
 * origin; it exposes nothing beyond "the proxy is up".
 *
 * Upstream trust fence (packages/client/connection/src/api-request-trust.ts)
 * requires the Host to be loopback and, when Origin is attached, to match it
 * exactly. Forwarded requests therefore get `Host: 127.0.0.1:<target>` and
 * have `Origin` stripped — the proxy's token gate is the cross-site boundary
 * upstream deliberately does not provide.
 *
 * Env:
 *   DSH_REMOTE_TOKEN (required)  shared secret; compared in constant time
 *   DSH_LISTEN_HOST   default 0.0.0.0      DSH_LISTEN_PORT  default 3081
 *   DSH_TARGET_HOST   default 127.0.0.1    DSH_TARGET_PORT  default 3080
 *
 * Plain HTTP only by design: phase 2 terminates TLS here (ADR-0004); until
 * then deploy on trusted LANs / mesh VPNs only.
 */
import http from 'node:http'
import crypto from 'node:crypto'

const TOKEN = process.env.DSH_REMOTE_TOKEN
if (!TOKEN || TOKEN.length < 8) {
  console.error('dsh-remote: DSH_REMOTE_TOKEN is required (min 8 chars); refusing to run unauthenticated')
  process.exit(1)
}
const LISTEN_HOST = process.env.DSH_LISTEN_HOST ?? '0.0.0.0'
const LISTEN_PORT = Number(process.env.DSH_LISTEN_PORT ?? 3081)
const TARGET_HOST = process.env.DSH_TARGET_HOST ?? '127.0.0.1'
const TARGET_PORT = Number(process.env.DSH_TARGET_PORT ?? 3080)
const TARGET_AUTHORITY = `${TARGET_HOST}:${TARGET_PORT}`
const COOKIE_NAME = 'dsh_token'

/** Constant-time token comparison; length-mismatched candidates fail fast. */
function tokenOk(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return false
  const a = Buffer.from(candidate)
  const b = Buffer.from(TOKEN)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

function bearerToken(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')
  return m?.[1]
}

function sessionCookie() {
  // No Secure flag: LAN deployments are plain HTTP until phase-2 TLS (ADR-0004).
  return `${COOKIE_NAME}=${TOKEN}; HttpOnly; SameSite=Lax; Path=/`
}

function stripTokenParam(url) {
  url.searchParams.delete('token')
  return url.pathname + (url.searchParams.size ? url.search : '')
}

function reject(res, code, message) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><meta charset="utf-8"><title>${code}</title><body style="font-family:sans-serif;background:#0d1117;color:#e6edf3;display:grid;place-items:center;min-height:100vh"><div><h1>${code} ${message}</h1><p>请通过启动页携带令牌重新连接。</p></div>`)
}

/** Headers safe to forward upstream: loopback Host, no Origin (see file header). */
function upstreamHeaders(req) {
  const headers = { ...req.headers }
  headers.host = TARGET_AUTHORITY
  delete headers.origin
  delete headers.connection
  delete headers['keep-alive']
  delete headers['transfer-encoding']
  return headers
}

function forwardHttp(req, res, path) {
  const upstream = http.request({
    host: TARGET_HOST,
    port: TARGET_PORT,
    method: req.method,
    path,
    headers: upstreamHeaders(req),
  })
  upstream.on('response', (upRes) => {
    res.writeHead(upRes.statusCode ?? 502, upRes.headers)
    upRes.pipe(res)
  })
  upstream.on('error', (error) => {
    if (!res.headersSent) reject(res, 502, `上游主机不可达：${error.message}`)
    else res.destroy()
  })
  req.pipe(upstream)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (url.pathname === '/healthz') {
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    })
    res.end('{"ok":true}')
    return
  }

  const queryToken = url.searchParams.get('token')
  if (tokenOk(queryToken)) {
    // Login: plant the session cookie and bounce to the token-free URL.
    res.writeHead(302, { location: stripTokenParam(url), 'set-cookie': sessionCookie() })
    res.end()
    return
  }
  if (!tokenOk(readCookie(req, COOKIE_NAME)) && !tokenOk(bearerToken(req))) {
    reject(res, 401, '未授权')
    return
  }
  forwardHttp(req, res, stripTokenParam(url))
})

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const ok = tokenOk(url.searchParams.get('token'))
    || tokenOk(readCookie(req, COOKIE_NAME))
    || tokenOk(bearerToken(req))
  if (!ok) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }
  const upstream = http.request({
    host: TARGET_HOST,
    port: TARGET_PORT,
    method: 'GET',
    path: stripTokenParam(url),
    headers: upstreamHeaders(req),
  })
  upstream.on('upgrade', (upRes, upSocket, upHead) => {
    const lines = Object.entries(upRes.headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`)
      .join('')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines}\r\n`)
    if (upHead?.length) socket.write(upHead)
    upSocket.pipe(socket)
    socket.pipe(upSocket)
    if (head?.length) upSocket.write(head)
    upSocket.on('error', () => socket.destroy())
    socket.on('error', () => upSocket.destroy())
  })
  upstream.on('response', (upRes) => {
    // Upgrade refused upstream: surface the status and tear down.
    socket.write(`HTTP/1.1 ${upRes.statusCode} Upgrade Refused\r\n\r\n`)
    socket.destroy()
    upRes.resume()
  })
  upstream.on('error', () => {
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
    socket.destroy()
  })
  upstream.end()
})

// SSE streams and WS tunnels are long-lived; Node's default request/headers
// timeouts would kill them mid-session.
server.requestTimeout = 0
server.headersTimeout = 0
server.timeout = 0

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`dsh-remote: http://${LISTEN_HOST}:${LISTEN_PORT} -> http://${TARGET_AUTHORITY} (token required)`)
})
