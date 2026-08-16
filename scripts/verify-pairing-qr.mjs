#!/usr/bin/env node
import crypto from 'node:crypto'
import {
  discoverPublicBases,
  normalizePublicBase,
  pairingUrls,
  renderSvgQr,
  renderTerminalQr,
} from '../proxy/pairing-qr.mjs'

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function rejects(fn, pattern) {
  try {
    fn()
  } catch (error) {
    expect(pattern.test(error.message), `unexpected error: ${error.message}`)
    return
  }
  throw new Error('expected function to reject')
}

expect(normalizePublicBase('https://dsh.example.test') === 'https://dsh.example.test/',
  'standard HTTPS origin was not normalized')
expect(normalizePublicBase('http://192.168.1.9:3081/') === 'http://192.168.1.9:3081/',
  'LAN origin was not preserved')
rejects(() => normalizePublicBase('ftp://host.test'), /http/)
rejects(() => normalizePublicBase('https://host.test/path'), /origin/)
rejects(() => normalizePublicBase('https://user:pass@host.test/'), /origin/)
console.log('ok   public URL accepts only clean HTTP(S) origins')

const discovered = discoverPublicBases({
  scheme: 'http',
  listenHost: '0.0.0.0',
  listenPort: 3081,
  interfaces: {
    lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    en0: [{ family: 'IPv4', address: '192.168.1.9', internal: false }],
    utun0: [{ family: 'IPv4', address: '100.64.0.8', internal: false }],
  },
})
expect(JSON.stringify(discovered) === JSON.stringify([
  'http://192.168.1.9:3081/',
  'http://100.64.0.8:3081/',
]), `unexpected discovered URLs: ${JSON.stringify(discovered)}`)
expect(discoverPublicBases({
  scheme: 'https',
  listenHost: '0.0.0.0',
  listenPort: 443,
  publicUrl: 'https://dsh.example.test',
})[0] === 'https://dsh.example.test/', 'public URL override was ignored')
console.log('ok   LAN discovery and DSH_PUBLIC_URL override are deterministic')

const url = pairingUrls(['http://192.168.1.9:3081/'], '381204')[0]
expect(url === 'http://192.168.1.9:3081/launch#pair=381204', `unsafe pairing URL: ${url}`)
expect(!url.includes('token'), 'pairing URL contains a token field')
rejects(() => pairingUrls(['http://host.test/'], '123'), /6 digits/)
console.log('ok   pairing links use /launch plus a fragment-only single-use code')

const rendered = renderTerminalQr(url)
const lines = rendered.split('\n')
expect(lines.length >= 15 && lines.length <= 30, `unexpected terminal QR height: ${lines.length}`)
expect(lines.every((line) => line.endsWith('\x1b[0m')), 'terminal QR line does not reset ANSI colors')
const digest = crypto.createHash('sha256').update(rendered).digest('hex')
expect(digest === 'eedb73fb0476e384de885e25507428380e6369f3f99a7c655891a4cfe54b6d78',
  `terminal QR snapshot changed: ${digest}`)
console.log('ok   terminal QR matches the pinned encoder snapshot')

const svg = renderSvgQr(url)
expect(svg.startsWith('<svg ') && svg.includes('LAN pairing QR code'), 'SVG QR renderer returned invalid markup')
console.log('ok   SVG QR renderer is available to Web hosts')

console.log('\nall pairing QR checks passed')
