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
 * Pairing (ADR-0006): phones exchange a short single-use code for the master
 * token instead of typing it.
 *   - `POST /pair/new` (master-token auth) mints a 6-digit code: single use,
 *     10-minute TTL, minting requires the bearer/cookie master token.
 *   - `POST /pair` (public, CORS `*` incl. OPTIONS preflight) trades a valid
 *     code for `{token}`; wrong/expired codes 403, per-source-IP attempts
 *     limited to 10/min (429 beyond).
 *   - One initial code is printed at startup.
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
 * TLS (ADR-0006): when DSH_TLS_CERT and DSH_TLS_KEY are both set, the proxy
 * serves HTTPS (WSS on the same port; session cookie gains `Secure`). Certs
 * are always user-supplied — self-signed certs are unusable in stock
 * WebViews; public deployments belong behind a real CA (Caddy/Let's
 * Encrypt). LANs stay plain HTTP + token.
 *
 * Web mode (ADR-0007): when the launcher page is available, unauthenticated
 * GET / (and /index.html) return the launcher instead of 401, and GET /launch
 * always returns it — any browser can then pair via POST /pair and log in
 * through ?token=. The gate is unchanged: /api, WebSocket upgrades and the
 * real UI assets still require the token; the launcher is a static page with
 * no secrets. Resolution: DSH_LAUNCHER=<path> (explicit; unreadable fails
 * loud) → app/www/index.html next to this file (missing → off with a boot
 * note) → DSH_LAUNCHER=off forces the plain 401 face.
 *
 * Env:
 *   DSH_REMOTE_TOKEN (required)  shared secret; compared in constant time
 *   DSH_LISTEN_HOST   default 0.0.0.0      DSH_LISTEN_PORT  default 3081
 *   DSH_TARGET_HOST   default 127.0.0.1    DSH_TARGET_PORT  default 3080
 *   DSH_TLS_CERT / DSH_TLS_KEY  (optional, both required)  PEM file paths
 *   DSH_LAUNCHER      (optional) launcher HTML path, or "off"
 */
import http from 'node:http'
import https from 'node:https'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

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

// Optional TLS (ADR-0006): both PEM paths required, loaded at boot, fail loud.
const TLS_CERT_PATH = process.env.DSH_TLS_CERT
const TLS_KEY_PATH = process.env.DSH_TLS_KEY
if ((TLS_CERT_PATH === undefined) !== (TLS_KEY_PATH === undefined)) {
  console.error('dsh-remote: DSH_TLS_CERT and DSH_TLS_KEY must be set together')
  process.exit(1)
}
const TLS = TLS_CERT_PATH !== undefined
  ? { cert: fs.readFileSync(TLS_CERT_PATH), key: fs.readFileSync(TLS_KEY_PATH) }
  : undefined
const SCHEME = TLS ? 'https' : 'http'

// Web mode (ADR-0007): serve the launcher page to unauthenticated browsers so
// any phone/desktop browser can pair without installing the app. Resolution:
// DSH_LAUNCHER=<path> (explicit; unreadable → fail loud) → repo-layout default
// app/www/index.html (missing → off, with a boot note) → DSH_LAUNCHER=off.
const LAUNCHER_ENV = process.env.DSH_LAUNCHER
let LAUNCHER_HTML
if (LAUNCHER_ENV !== 'off') {
  const launcherPath = LAUNCHER_ENV ?? fileURLToPath(new URL('../app/www/index.html', import.meta.url))
  try {
    LAUNCHER_HTML = fs.readFileSync(launcherPath)
    console.log(`dsh-remote: web mode on — launcher ${launcherPath}`)
  } catch (error) {
    if (LAUNCHER_ENV) {
      console.error(`dsh-remote: DSH_LAUNCHER=${LAUNCHER_ENV} is not readable: ${error.message}`)
      process.exit(1)
    }
    console.log('dsh-remote: web mode off — no launcher page found next to the repo layout')
  }
}

/** Constant-time token comparison; length-mismatched candidates fail fast. */
function tokenOk(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return false
  const a = Buffer.from(candidate)
  const b = Buffer.from(TOKEN)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// ── pairing codes (ADR-0006) ─────────────────────────────────────────────
const PAIR_CODE_TTL_MS = 10 * 60 * 1000
const PAIR_RATE_WINDOW_MS = 60 * 1000
const PAIR_RATE_MAX = 10
/** @type {Map<string, number>} code → expiry epoch ms */
const pairCodes = new Map()
/** @type {Map<string, {count: number, resetAt: number}>} source IP → attempts */
const pairAttempts = new Map()

function mintPairCode() {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  pairCodes.set(code, Date.now() + PAIR_CODE_TTL_MS)
  return code
}

/** Redeem a code; single-use and expiry enforced. @returns {boolean} */
function redeemPairCode(code) {
  const expiry = pairCodes.get(code)
  if (expiry === undefined) return false
  pairCodes.delete(code)
  return expiry > Date.now()
}

function pairRateLimited(ip) {
  const now = Date.now()
  const entry = pairAttempts.get(ip)
  if (entry === undefined || entry.resetAt <= now) {
    pairAttempts.set(ip, { count: 1, resetAt: now + PAIR_RATE_WINDOW_MS })
    return false
  }
  entry.count += 1
  return entry.count > PAIR_RATE_MAX
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
  // Secure only under TLS (ADR-0006): a Secure cookie on plain HTTP would
  // never be stored by the WebView.
  const secure = TLS ? '; Secure' : ''
  return `${COOKIE_NAME}=${TOKEN}; HttpOnly; SameSite=Lax; Path=/${secure}`
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

/**
 * Upgrade headers: same Host/Origin treatment, but the WS handshake headers
 * (connection/upgrade/sec-websocket-*) must survive verbatim — dropping
 * `connection: Upgrade` turns the handshake into a plain GET (upstream 426).
 */
function upgradeHeaders(req) {
  const headers = { ...req.headers }
  headers.host = TARGET_AUTHORITY
  delete headers.origin
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

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function json(res, code, body, extraHeaders = {}) {
  res.writeHead(code, { 'content-type': 'application/json', ...extraHeaders })
  res.end(JSON.stringify(body))
}

/** Read a small JSON body (≤64 KiB); resolves undefined on malformed input. */
function readJsonBody(req) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        req.destroy()
        resolve(undefined)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(undefined)
      }
    })
    req.on('error', () => resolve(undefined))
  })
}

const server = (TLS ? https.createServer(TLS, handle) : http.createServer(handle))

async function handle(req, res) {
  const url = new URL(req.url ?? '/', `${SCHEME}://${req.headers.host ?? 'localhost'}`)

  if (url.pathname === '/healthz') {
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    })
    res.end('{"ok":true}')
    return
  }

  // Web mode (ADR-0007): /launch always serves the launcher when enabled —
  // authenticated users land here to switch hosts.
  if (url.pathname === '/launch' && req.method === 'GET') {
    if (!LAUNCHER_HTML) {
      reject(res, 404, '未启用 Web 模式')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(LAUNCHER_HTML)
    return
  }

  // ── pairing endpoints (ADR-0006) ─────────────────────────────────────
  if (url.pathname === '/pair' && req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }
  if (url.pathname === '/pair' && req.method === 'POST') {
    const ip = req.socket.remoteAddress ?? 'unknown'
    if (pairRateLimited(ip)) {
      json(res, 429, { error: 'too_many_attempts' }, CORS_HEADERS)
      return
    }
    const body = await readJsonBody(req)
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    if (!/^\d{6}$/.test(code) || !redeemPairCode(code)) {
      json(res, 403, { error: 'invalid_or_expired_code' }, CORS_HEADERS)
      return
    }
    json(res, 200, { token: TOKEN }, CORS_HEADERS)
    return
  }
  if (url.pathname === '/pair/new' && req.method === 'POST') {
    if (!tokenOk(readCookie(req, COOKIE_NAME)) && !tokenOk(bearerToken(req))) {
      json(res, 401, { error: 'unauthorized' })
      return
    }
    const code = mintPairCode()
    json(res, 200, { code, expiresInSeconds: PAIR_CODE_TTL_MS / 1000 })
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
    // Web mode (ADR-0007): the launcher is the unauthenticated face of /.
    // Only the bare index paths — /api, WS and UI assets stay gated.
    if (LAUNCHER_HTML && req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(LAUNCHER_HTML)
      return
    }
    reject(res, 401, '未授权')
    return
  }
  forwardHttp(req, res, stripTokenParam(url))
}

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
    headers: upgradeHeaders(req),
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
  console.log(`dsh-remote: ${SCHEME}://${LISTEN_HOST}:${LISTEN_PORT} -> http://${TARGET_AUTHORITY} (token required)`)
  console.log(`dsh-remote: pairing code ${mintPairCode()} — single use, expires in 10 min`)
  console.log('dsh-remote: mint more with  curl -X POST -H "Authorization: Bearer $DSH_REMOTE_TOKEN" <this-url>/pair/new')
})
