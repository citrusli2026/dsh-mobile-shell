#!/usr/bin/env node
/** Regression checks for the actual inline launcher script, without a DOM lib. */
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const launcherPath = fileURLToPath(new URL('../app/www/index.html', import.meta.url))
const html = fs.readFileSync(launcherPath, 'utf8')
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1]
if (!script) throw new Error('launcher inline script not found')

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function launcherContext({ app = false, hash = '', search = '', savedConnection } = {}) {
  const elements = new Map()
  const element = (id) => {
    if (!elements.has(id)) {
      const initiallyHidden = new Set(['savedCard', 'tokenForm', 'webHostLine'])
      const classes = new Set(initiallyHidden.has(id) ? ['hidden'] : [])
      elements.set(id, {
        id,
        value: '',
        textContent: '',
        className: '',
        disabled: false,
        classList: {
          add: (...names) => names.forEach((name) => classes.add(name)),
          remove: (...names) => names.forEach((name) => classes.delete(name)),
          contains: (name) => classes.has(name),
        },
        querySelector: (selector) => selector === '.btn__text'
          ? element(`${id}Text`)
          : null,
        focus() {},
      })
    }
    return elements.get(id)
  }
  const stored = new Map()
  if (savedConnection) stored.set('dsh.connection', JSON.stringify(savedConnection))
  const assigned = []
  const historyCalls = []
  let fetchCalls = 0
  const context = vm.createContext({
    window: app ? { Capacitor: {}, addEventListener() {} } : { addEventListener() {} },
    document: { body: element('body'), getElementById: element },
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
    location: {
      origin: 'http://127.0.0.1:3081',
      host: '127.0.0.1:3081',
      pathname: '/',
      search,
      hash,
      assign: (value) => assigned.push(value),
      replace: (value) => assigned.push(value),
    },
    history: { replaceState: (_state, _unused, value) => historyCalls.push(value) },
    fetch: async () => {
      fetchCalls += 1
      throw new Error('unexpected fetch in launcher unit check')
    },
    AbortController,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback) => callback(),
    console,
  })
  vm.runInContext(script, context, { filename: launcherPath })
  return { context, stored, assigned, elements, historyCalls, get fetchCalls() { return fetchCalls } }
}

const browser = launcherContext()
const normalize = (value) => vm.runInContext(`normalize(${JSON.stringify(value)}).origin`, browser.context)
const cases = [
  ['192.168.1.20', 'http://192.168.1.20:3081'],
  ['192.168.1.20:4090', 'http://192.168.1.20:4090'],
  ['http://example.test', 'http://example.test'],
  ['http://example.test:80', 'http://example.test'],
  ['https://example.test', 'https://example.test'],
  ['https://example.test:443', 'https://example.test'],
  ['https://example.test:8443/path?x=1#part', 'https://example.test:8443'],
]
for (const [input, expected] of cases) {
  const actual = normalize(input)
  expect(actual === expected, `normalize(${input}) => ${actual}, expected ${expected}`)
  console.log(`ok   normalize ${input} → ${actual}`)
}

vm.runInContext("save('https://example.test/', 'must-not-be-saved')", browser.context)
const browserSaved = JSON.parse(browser.stored.get('dsh.connection'))
expect(browserSaved.base === 'https://example.test/', 'browser base was not saved')
expect(browserSaved.token === undefined, 'browser persisted a token in localStorage')
console.log('ok   browser localStorage contains no token')

const qr = launcherContext({
  hash: '#pair=381204',
  savedConnection: { base: 'http://old-host.test:3081/', at: 1 },
})
expect(qr.elements.get('code').value === '381204', 'QR pairing code was not prefilled')
expect(qr.elements.get('pairBtnText').textContent === '确认配对并连接', 'QR confirmation label missing')
expect(qr.elements.get('statusText').textContent.includes('请确认连接'), 'QR confirmation status missing')
expect(qr.historyCalls[0] === '/', `QR fragment was not removed: ${JSON.stringify(qr.historyCalls)}`)
expect(qr.fetchCalls === 0, 'QR link consumed the code without explicit confirmation')
expect(qr.elements.get('savedCard').classList.contains('hidden'), 'saved host hid the QR pairing form')
console.log('ok   QR fragment prefills once, clears the URL, and waits for confirmation')

const invalidQr = launcherContext({ hash: '#pair=not-a-code' })
expect(!invalidQr.elements.has('code') || invalidQr.elements.get('code').value === '', 'invalid QR code was accepted')
expect(invalidQr.elements.get('statusText').textContent.includes('无效'), 'invalid QR error missing')
expect(invalidQr.historyCalls[0] === '/', 'invalid QR fragment was not removed')
console.log('ok   invalid QR fragments fail closed and are removed')

const legacyQuery = launcherContext({ search: '?token=legacy-secret&keep=1', hash: '#pair=381204' })
expect(legacyQuery.historyCalls[0] === '/?keep=1',
  `legacy token query was not removed: ${JSON.stringify(legacyQuery.historyCalls)}`)
console.log('ok   legacy token query is removed from launcher history')

const app = launcherContext({ app: true })
vm.runInContext("enterWithAppToken('http://host.test:3081/', 'device-token')", app.context)
const appSaved = JSON.parse(app.stored.get('dsh.connection'))
expect(appSaved.token === 'device-token', 'App did not retain its scoped device token')
expect(app.assigned[0] === 'http://host.test:3081/#dsh-session=device-token', `unsafe App handoff URL: ${app.assigned[0]}`)
expect(!app.assigned[0].includes('?token='), 'App handoff leaked token into the query string')
console.log('ok   App handoff uses a fragment, never a token query parameter')

console.log('\nall launcher checks passed')
