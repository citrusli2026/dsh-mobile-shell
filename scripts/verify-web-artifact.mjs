#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifactRoot = path.resolve(process.argv[2] ?? path.join(repoRoot, 'dist', 'web'))
const manifestPath = path.join(artifactRoot, 'web-artifact.json')
if (!existsSync(manifestPath)) throw new Error(`Web artifact manifest is missing: ${manifestPath}`)

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.format !== 'dsh-mobile-shell-web' || manifest.formatVersion !== 1) {
  throw new Error('unsupported Web artifact format')
}
if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
  throw new Error('Web artifact version is missing')
}

function entrypoint(name) {
  const value = manifest.entrypoints?.[name]
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)) {
    throw new Error(`invalid ${name} entrypoint`)
  }
  const resolved = path.resolve(artifactRoot, value)
  const relative = path.relative(artifactRoot, resolved)
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`${name} entrypoint escapes the artifact root`)
  }
  if (!existsSync(resolved)) throw new Error(`${name} entrypoint is missing: ${value}`)
  return resolved
}

const proxyPath = entrypoint('proxy')
const launcherPath = entrypoint('launcher')
const pairingPath = entrypoint('pairing')
for (const sourcePath of [proxyPath, pairingPath, path.join(artifactRoot, 'start.mjs')]) {
  const check = spawnSync(process.execPath, ['--check', sourcePath], { encoding: 'utf8' })
  if (check.status !== 0) throw new Error(`syntax check failed for ${sourcePath}: ${check.stderr}`)
}

const launcher = readFileSync(launcherPath, 'utf8')
if (!launcher.includes('dsh-remote') || !launcher.includes("fetch(base + 'pair'")) {
  throw new Error('launcher does not look like the dsh Web launcher')
}
for (const forbidden of ['app/android', 'app/ios', 'node_modules']) {
  if (existsSync(path.join(artifactRoot, forbidden))) throw new Error(`forbidden path in Web artifact: ${forbidden}`)
}
console.log(`ok   Web artifact ${manifest.version} (${artifactRoot})`)
