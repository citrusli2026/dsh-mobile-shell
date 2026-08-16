import { networkInterfaces } from 'node:os'
import { qrcodegen } from './vendor/qrcodegen.mjs'

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]'])

export function normalizePublicBase(input) {
  const url = new URL(input)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('DSH_PUBLIC_URL must use http:// or https://')
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('DSH_PUBLIC_URL must be an origin without credentials, path, query, or fragment')
  }
  return `${url.origin}/`
}

function urlHost(host) {
  const unwrapped = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  return unwrapped.includes(':') ? `[${unwrapped}]` : unwrapped
}

function baseForHost(scheme, host, port) {
  const defaultPort = (scheme === 'http' && port === 80) || (scheme === 'https' && port === 443)
  return `${scheme}://${urlHost(host)}${defaultPort ? '' : `:${port}`}/`
}

export function discoverPublicBases({
  scheme,
  listenHost,
  listenPort,
  publicUrl,
  interfaces = networkInterfaces(),
}) {
  if (publicUrl) return [normalizePublicBase(publicUrl)]
  if (scheme !== 'http' && scheme !== 'https') throw new Error(`unsupported scheme: ${scheme}`)
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
    throw new Error(`invalid listen port: ${listenPort}`)
  }

  let hosts
  if (WILDCARD_HOSTS.has(listenHost)) {
    hosts = Object.values(interfaces)
      .flatMap((entries) => entries ?? [])
      .filter((entry) => (entry.family === 'IPv4' || entry.family === 4) && !entry.internal)
      .map((entry) => entry.address)
  } else {
    hosts = [listenHost]
  }
  const unique = [...new Set(hosts)]
  if (unique.length === 0) unique.push('127.0.0.1')
  return unique.map((host) => baseForHost(scheme, host, listenPort))
}

export function pairingUrls(bases, code) {
  if (!/^\d{6}$/.test(code)) throw new Error('pairing code must be 6 digits')
  return bases.map((base) => {
    const url = new URL('launch', base)
    url.hash = new URLSearchParams({ pair: code }).toString()
    return url.toString()
  })
}

export function renderTerminalQr(text, border = 4) {
  if (!Number.isInteger(border) || border < 0) throw new Error('QR border must be a non-negative integer')
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM)
  const moduleAt = (x, y) => x >= 0 && y >= 0 && x < qr.size && y < qr.size && qr.getModule(x, y)
  const lines = []
  for (let y = -border; y < qr.size + border; y += 2) {
    let line = ''
    for (let x = -border; x < qr.size + border; x += 1) {
      const foreground = moduleAt(x, y) ? 30 : 97
      const background = moduleAt(x, y + 1) ? 40 : 107
      line += `\x1b[${foreground};${background}m▀`
    }
    lines.push(`${line}\x1b[0m`)
  }
  return lines.join('\n')
}

/** Render the same encoder output as a self-contained SVG for Web hosts. */
export function renderSvgQr(text, border = 4) {
  if (!Number.isInteger(border) || border < 0) throw new Error('QR border must be a non-negative integer')
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM)
  const size = qr.size + border * 2
  const modules = []
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (qr.getModule(x, y)) modules.push(`<rect x="${x + border}" y="${y + border}" width="1" height="1"/>`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="LAN pairing QR code" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${modules.join('')}</g></svg>`
}
