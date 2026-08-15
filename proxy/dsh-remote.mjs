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
 *   1. `GET <any-path>?token=<t>` — legacy login: validates, down-scopes a
 *      master credential, sets an HttpOnly `dsh_token` cookie and redirects
 *      to the token-free URL. New launchers use POST /session instead.
 *   2. `Cookie: dsh_token=<t>` — session requests after login.
 *   3. `Authorization: Bearer <t>` — non-browser clients.
 *
 * Pairing (ADR-0006, hardened by ADR-0008): clients exchange a short
 * single-use code for a signed, 30-day device credential. The master token
 * stays on the host. It mints pairing codes and remains a compatibility
 * bootstrap credential; browser login always down-scopes it before storage.
 *   - `POST /pair/new` (master-token auth) mints a 6-digit code: single use,
 *     10-minute TTL, minting requires the bearer/cookie master token.
 *   - `POST /pair` (public, CORS `*` incl. OPTIONS preflight) sets an HttpOnly
 *     device cookie for browsers. The bundled App compatibility path receives
 *     the same scoped device credential, never the master token.
 *   - `POST /session` turns a valid master/device bearer into an HttpOnly
 *     device cookie; a master credential is always down-scoped first.
 *   - One initial code, copyable pairing URL and (in an interactive terminal)
 *     local QR code are printed at startup. The QR fragment carries only the
 *     short-lived single-use code, never a master/device credential.
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
 * always returns it — any browser can then pair via POST /pair and receive an
 * HttpOnly session cookie. The gate is unchanged: /api, WebSocket upgrades and the
 * real UI assets still require the token; the launcher is a static page with
 * no secrets. Resolution: DSH_LAUNCHER=<path> (explicit; unreadable fails
 * loud) → app/www/index.html next to this file (missing → off with a boot
 * note) → DSH_LAUNCHER=off forces the plain 401 face.
 * LAN HTTP compatibility: the upstream UI calls the Web Crypto
 * `crypto.randomUUID()` API, which browsers expose only in secure contexts.
 * The proxy serves the UI over plain HTTP for trusted LAN deployments, so the
 * authenticated HTML document gets a small `getRandomValues()`-based fallback
 * before the upstream modules load. Native implementations are never replaced.
 *
 * Env:
 *   DSH_REMOTE_TOKEN (required)  shared secret; compared in constant time
 *   DSH_LISTEN_HOST   default 0.0.0.0      DSH_LISTEN_PORT  default 3081
 *   DSH_TARGET_HOST   default 127.0.0.1    DSH_TARGET_PORT  default 3080
 *   DSH_TLS_CERT / DSH_TLS_KEY  (optional, both required)  PEM file paths
 *   DSH_LAUNCHER      (optional) launcher HTML path, or "off"
 *   DSH_PUBLIC_URL    (optional) public proxy origin used in pairing links
 *   DSH_PAIR_QR       default on in a TTY; set "off" to hide terminal QR
 */
import http from 'node:http'
import https from 'node:https'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { discoverPublicBases, pairingUrls, renderTerminalQr } from './pairing-qr.mjs'

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
const DEVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
const DEVICE_TOKEN_PREFIX = 'dshd1'

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
let PAIRING_BASES
try {
  PAIRING_BASES = discoverPublicBases({
    scheme: SCHEME,
    listenHost: LISTEN_HOST,
    listenPort: LISTEN_PORT,
    publicUrl: process.env.DSH_PUBLIC_URL,
  })
} catch (error) {
  console.error(`dsh-remote: invalid pairing URL configuration: ${error.message}`)
  process.exit(1)
}

// Chromium/Safari expose crypto.getRandomValues() on LAN HTTP pages, but keep
// crypto.randomUUID() behind the secure-context boundary. dsh uses the latter
// for client-side request IDs, so the fallback must run before its module graph.
const RANDOM_UUID_POLYFILL_MARKER = 'data-dsh-remote-random-uuid-polyfill'
const RANDOM_UUID_POLYFILL = `<script ${RANDOM_UUID_POLYFILL_MARKER}>
(() => {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi || typeof cryptoApi.randomUUID === 'function'
      || typeof cryptoApi.getRandomValues !== 'function') return
  const randomUUID = () => {
    const bytes = new Uint8Array(16)
    cryptoApi.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16)
      + '-' + hex.slice(16, 20) + '-' + hex.slice(20)
  }
  Object.defineProperty(cryptoApi, 'randomUUID', {
    configurable: true,
    writable: true,
    value: randomUUID,
  })
})()
</script>`

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

/**
 * Device tokens are signed, time-limited bearer credentials. They have the
 * same request access as the master token, but cannot mint pairing codes and
 * rotating DSH_REMOTE_TOKEN invalidates every issued device token.
 */
function mintDeviceToken() {
  const payload = Buffer.from(JSON.stringify({
    id: crypto.randomUUID(),
    exp: Date.now() + DEVICE_TOKEN_TTL_MS,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', TOKEN).update(payload).digest('base64url')
  return `${DEVICE_TOKEN_PREFIX}.${payload}.${signature}`
}

function deviceTokenOk(candidate) {
  if (typeof candidate !== 'string') return false
  const [prefix, payload, signature, extra] = candidate.split('.')
  if (prefix !== DEVICE_TOKEN_PREFIX || !payload || !signature || extra !== undefined) return false
  const expected = crypto.createHmac('sha256', TOKEN).update(payload).digest('base64url')
  // Buffer.from(..., 'base64url') accepts non-canonical trailing pad bits. A
  // byte-wise comparison alone would therefore accept alternate spellings of
  // the same signature, so require the canonical encoding before comparing.
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(signature)
  if (actualBytes.length !== expectedBytes.length
      || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return false
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof claims.id === 'string'
      && claims.id.length > 0
      && Number.isSafeInteger(claims.exp)
      && claims.exp > Date.now()
  } catch {
    return false
  }
}

function accessTokenOk(candidate) {
  return tokenOk(candidate) || deviceTokenOk(candidate)
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

function pairingInfo(code) {
  return {
    code,
    expiresInSeconds: PAIR_CODE_TTL_MS / 1000,
    pairingUrls: LAUNCHER_HTML ? pairingUrls(PAIRING_BASES, code) : [],
  }
}

function announcePairingCode(code) {
  const info = pairingInfo(code)
  console.log(`dsh-remote: pairing code ${code} — single use, expires in 10 min`)
  for (const url of info.pairingUrls) console.log(`dsh-remote: pairing link ${url}`)
  const showQr = process.stdout.isTTY
    && process.env.DSH_PAIR_QR !== 'off'
    && process.env.NO_COLOR === undefined
    && info.pairingUrls.length > 0
  if (showQr) {
    console.log('dsh-remote: scan to prefill the pairing code, then confirm once:')
    console.log(renderTerminalQr(info.pairingUrls[0]))
  }
  return info
}

function enableTerminalPairing() {
  if (!process.stdin.isTTY) return
  process.stdin.setEncoding('utf8')
  let pending = ''
  process.stdin.on('data', (chunk) => {
    pending += chunk
    let newline
    while ((newline = pending.indexOf('\n')) >= 0) {
      const command = pending.slice(0, newline).trim().toLowerCase()
      pending = pending.slice(newline + 1)
      if (command === 'n' || command === 'new') announcePairingCode(mintPairCode())
      else if (command) console.log('dsh-remote: unknown terminal command; enter n for a new pairing QR')
    }
  })
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

function sessionCookie(value) {
  // Secure only under TLS (ADR-0006): a Secure cookie on plain HTTP would
  // never be stored by the WebView.
  const secure = TLS ? '; Secure' : ''
  return `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DEVICE_TOKEN_TTL_MS / 1000}${secure}`
}

function stripTokenParam(url) {
  url.searchParams.delete('token')
  return url.pathname + (url.searchParams.size ? url.search : '')
}

function reject(res, code, message) {
  const escapedMessage = String(message).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char])
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><meta charset="utf-8"><title>${code}</title><body style="font-family:sans-serif;background:#0d1117;color:#e6edf3;display:grid;place-items:center;min-height:100vh"><div><h1>${code} ${escapedMessage}</h1><p>请通过启动页携带令牌重新连接。</p></div>`)
}

/** Headers safe to forward upstream: loopback Host, no Origin (see file header). */
function upstreamHeaders(req, { htmlDocument = false } = {}) {
  const headers = { ...req.headers }
  headers.host = TARGET_AUTHORITY
  delete headers.origin
  delete headers.connection
  delete headers['keep-alive']
  delete headers['transfer-encoding']
  if (htmlDocument) {
    // The HTML must be buffered and rewritten. Avoid compressed/conditional
    // responses, which otherwise cannot be safely patched in this proxy.
    headers['accept-encoding'] = 'identity'
    delete headers['if-none-match']
    delete headers['if-modified-since']
  }
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

function frontendDocumentPath(path) {
  try {
    const pathname = new URL(path, 'http://dsh.internal').pathname
    return pathname === '/' || pathname === '/index.html'
  } catch {
    return false
  }
}

function injectRandomUuidPolyfill(body) {
  const source = body.toString('utf8')
  if (source.includes(RANDOM_UUID_POLYFILL_MARKER)) return { body, changed: false }
  const head = /<head\b[^>]*>/i.exec(source)
  if (!head) return { body, changed: false }
  const patched = source.slice(0, head.index + head[0].length)
    + RANDOM_UUID_POLYFILL
    + source.slice(head.index + head[0].length)
  return { body: Buffer.from(patched, 'utf8'), changed: true }
}

function forwardHttp(req, res, path) {
  const htmlDocument = req.method !== 'HEAD' && frontendDocumentPath(path)
  const upstream = http.request({
    host: TARGET_HOST,
    port: TARGET_PORT,
    method: req.method,
    path,
    headers: upstreamHeaders(req, { htmlDocument }),
  })
  upstream.on('response', (upRes) => {
    const contentType = String(upRes.headers['content-type'] ?? '')
    const canPatch = htmlDocument
      && (upRes.statusCode ?? 500) >= 200
      && (upRes.statusCode ?? 500) < 300
      && contentType.toLowerCase().includes('text/html')
      && !upRes.headers['content-encoding']
    if (canPatch) {
      const chunks = []
      upRes.on('data', (chunk) => chunks.push(chunk))
      upRes.on('end', () => {
        const result = injectRandomUuidPolyfill(Buffer.concat(chunks))
        const headers = { ...upRes.headers }
        if (result.changed) {
          delete headers['transfer-encoding']
          delete headers.etag
          headers['content-length'] = result.body.length
        }
        res.writeHead(upRes.statusCode ?? 502, headers)
        res.end(result.body)
      })
      return
    }
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
  'access-control-allow-headers': 'content-type, x-dsh-client',
}

const LAUNCHER_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

function json(res, code, body, extraHeaders = {}) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders })
  res.end(JSON.stringify(body))
}

const BODY_TOO_LARGE = Symbol('body-too-large')

/** Read a small JSON body (≤64 KiB); resolves undefined on malformed input. */
function readJsonBody(req) {
  return new Promise((resolve) => {
    let size = 0
    let tooLarge = false
    const chunks = []
    req.on('data', (chunk) => {
      if (tooLarge) return
      size += chunk.length
      if (size > 64 * 1024) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) {
        resolve(BODY_TOO_LARGE)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(undefined)
      }
    })
    req.on('error', () => resolve(undefined))
  })
}

function requestUrl(req, scheme = SCHEME) {
  const host = req.headers.host
  if (host) {
    if (/[\s/@?#\\,]/.test(host)) return undefined
    try {
      // Validate Host, but never use it as the parsing base for the request
      // target. A malformed Host must be a 400, not an uncaught exception.
      new URL(`${scheme}://${host}`)
    } catch {
      return undefined
    }
  }
  const target = req.url ?? '/'
  if (!target.startsWith('/') || target.startsWith('//')) return undefined
  try {
    return new URL(target, `${scheme}://localhost`)
  } catch {
    return undefined
  }
}

function requestOriginOk(req) {
  const origin = req.headers.origin
  if (!origin) return true
  const host = req.headers.host
  if (!host) return false
  try {
    // Compare the browser authority to Host using the Origin's HTTP(S)
    // scheme. This remains same-host while allowing HTTPS to terminate at a
    // trusted front proxy before the request reaches this plain-HTTP server.
    const originUrl = new URL(origin)
    if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') return false
    return originUrl.origin === new URL(`${originUrl.protocol}//${host}`).origin
  } catch {
    return false
  }
}

function handleRequest(req, res) {
  handle(req, res).catch((error) => {
    console.error(`dsh-remote: request failed: ${error.message}`)
    if (!res.headersSent) reject(res, 500, '代理内部错误')
    else res.destroy()
  })
}

const server = (TLS ? https.createServer(TLS, handleRequest) : http.createServer(handleRequest))

async function handle(req, res) {
  const url = requestUrl(req)
  if (!url) {
    reject(res, 400, '请求地址无效')
    return
  }

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
    res.writeHead(200, LAUNCHER_HEADERS)
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
    if (body === BODY_TOO_LARGE) {
      json(res, 413, { error: 'payload_too_large' }, CORS_HEADERS)
      return
    }
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    if (!/^\d{6}$/.test(code) || !redeemPairCode(code)) {
      json(res, 403, { error: 'invalid_or_expired_code' }, CORS_HEADERS)
      return
    }
    const deviceToken = mintDeviceToken()
    const headers = { ...CORS_HEADERS, 'set-cookie': sessionCookie(deviceToken) }
    if (req.headers['x-dsh-client'] === 'app') {
      json(res, 200, { token: deviceToken, expiresInSeconds: DEVICE_TOKEN_TTL_MS / 1000 }, headers)
    } else {
      json(res, 200, { ok: true, expiresInSeconds: DEVICE_TOKEN_TTL_MS / 1000 }, headers)
    }
    return
  }
  if (url.pathname === '/pair/new' && req.method === 'POST') {
    if (!requestOriginOk(req)) {
      json(res, 403, { error: 'origin_forbidden' })
      return
    }
    if (!tokenOk(readCookie(req, COOKIE_NAME)) && !tokenOk(bearerToken(req))) {
      json(res, 401, { error: 'unauthorized' })
      return
    }
    const code = mintPairCode()
    const info = announcePairingCode(code)
    json(res, 200, info)
    return
  }

  if (url.pathname === '/session' && req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }
  if (url.pathname === '/session' && req.method === 'POST') {
    if (!requestOriginOk(req)) {
      json(res, 403, { error: 'origin_forbidden' }, CORS_HEADERS)
      return
    }
    const body = await readJsonBody(req)
    if (body === BODY_TOO_LARGE) {
      json(res, 413, { error: 'payload_too_large' }, CORS_HEADERS)
      return
    }
    const credential = typeof body?.token === 'string' ? body.token : ''
    if (!accessTokenOk(credential)) {
      json(res, 401, { error: 'unauthorized' }, CORS_HEADERS)
      return
    }
    const sessionToken = tokenOk(credential) ? mintDeviceToken() : credential
    json(res, 200, { ok: true }, { ...CORS_HEADERS, 'set-cookie': sessionCookie(sessionToken) })
    return
  }

  const queryToken = url.searchParams.get('token')
  if (accessTokenOk(queryToken)) {
    // Login: plant the session cookie and bounce to the token-free URL.
    const sessionToken = tokenOk(queryToken) ? mintDeviceToken() : queryToken
    res.writeHead(302, { location: stripTokenParam(url), 'set-cookie': sessionCookie(sessionToken) })
    res.end()
    return
  }
  if (!accessTokenOk(readCookie(req, COOKIE_NAME)) && !accessTokenOk(bearerToken(req))) {
    // Web mode (ADR-0007): the launcher is the unauthenticated face of /.
    // Only the bare index paths — /api, WS and UI assets stay gated.
    if (LAUNCHER_HTML && req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, LAUNCHER_HEADERS)
      res.end(LAUNCHER_HTML)
      return
    }
    reject(res, 401, '未授权')
    return
  }
  if (!requestOriginOk(req)) {
    reject(res, 403, '来源不允许')
    return
  }
  forwardHttp(req, res, stripTokenParam(url))
}

server.on('upgrade', (req, socket, head) => {
  const url = requestUrl(req, TLS ? 'https' : 'http')
  if (!url) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
    socket.destroy()
    return
  }
  const ok = accessTokenOk(url.searchParams.get('token'))
    || accessTokenOk(readCookie(req, COOKIE_NAME))
    || accessTokenOk(bearerToken(req))
  if (!ok || !requestOriginOk(req)) {
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

server.on('clientError', (_error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
})

// SSE streams and WS tunnels are long-lived; Node's default request/headers
// timeouts would kill them mid-session.
server.requestTimeout = 0
server.headersTimeout = 0
server.timeout = 0

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`dsh-remote: ${SCHEME}://${LISTEN_HOST}:${LISTEN_PORT} -> http://${TARGET_AUTHORITY} (token required)`)
  announcePairingCode(mintPairCode())
  if (process.stdin.isTTY) console.log('dsh-remote: enter n and press Return for a new pairing QR')
  console.log('dsh-remote: mint more with  curl -X POST -H "Authorization: Bearer $DSH_REMOTE_TOKEN" <this-url>/pair/new')
  enableTerminalPairing()
})
