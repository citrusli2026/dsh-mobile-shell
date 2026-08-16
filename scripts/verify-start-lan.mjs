import {
  choosePrivateLanIPv4,
  isPrivateLanIPv4,
  listPrivateLanIPv4,
  parsePort,
} from './start-lan.mjs'

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

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

console.log('all secure LAN launcher checks passed')
