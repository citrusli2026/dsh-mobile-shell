#!/usr/bin/env node
/**
 * Build the isolated, dependency-free Web runtime consumed by dsh-desktop and
 * usable by any Node >=20 host. Native Capacitor projects are deliberately not
 * part of this artifact.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = path.join(repoRoot, 'dist', 'web')
const rootPackageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))

const files = [
  ['app/www/index.html', 'app/www/index.html'],
  ['proxy/dsh-remote.mjs', 'proxy/dsh-remote.mjs'],
  ['proxy/pairing-qr.mjs', 'proxy/pairing-qr.mjs'],
  ['proxy/vendor/qrcodegen.mjs', 'proxy/vendor/qrcodegen.mjs'],
  ['web/start.mjs', 'start.mjs'],
  ['LICENSE', 'LICENSE'],
]

rmSync(outputRoot, { recursive: true, force: true })
mkdirSync(outputRoot, { recursive: true })
for (const [source, target] of files) {
  const sourcePath = path.join(repoRoot, source)
  const targetPath = path.join(outputRoot, target)
  if (!existsSync(sourcePath)) throw new Error(`Web artifact source is missing: ${source}`)
  mkdirSync(path.dirname(targetPath), { recursive: true })
  cpSync(sourcePath, targetPath)
}

const manifest = {
  format: 'dsh-mobile-shell-web',
  formatVersion: 1,
  version: rootPackageJson.version,
  runtime: { node: '>=20' },
  entrypoints: {
    proxy: 'proxy/dsh-remote.mjs',
    launcher: 'app/www/index.html',
    pairing: 'proxy/pairing-qr.mjs',
  },
}
writeFileSync(path.join(outputRoot, 'web-artifact.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(path.join(outputRoot, 'package.json'), `${JSON.stringify({
  name: 'dsh-mobile-shell-web',
  version: rootPackageJson.version,
  private: true,
  type: 'module',
  scripts: { start: 'node start.mjs' },
  engines: { node: '>=20' },
  license: 'MIT',
}, null, 2)}\n`)

const verification = spawnSync(process.execPath, [
  path.join(repoRoot, 'scripts', 'verify-web-artifact.mjs'),
  outputRoot,
], { stdio: 'inherit' })
if (verification.status !== 0) process.exit(verification.status ?? 1)

console.log(`Web artifact ready: ${outputRoot}`)
