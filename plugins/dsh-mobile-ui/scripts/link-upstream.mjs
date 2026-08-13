#!/usr/bin/env node
/**
 * Dev-loop upstream linker: point this package's type resolution at a
 * deepseek-harness repository checkout instead of the npm-published type
 * packages. Several @deepseek-ai/* npm packages are uninstallable today
 * (they declare dependencies on unpublished names such as dsh-compact), so
 * the contracts this plugin typechecks against come from the source plane of
 * the checkout. Build and install do NOT need this: value imports are either
 * externals the harness module table answers or npm packages (schemastery);
 * only `npm run typecheck` resolves these links.
 *
 * Usage: node scripts/link-upstream.mjs [repo-root]   (default: ../../..)
 * Re-run after a git pull or an npm install.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(pluginRoot, process.argv[2] ?? '../../..')

/** @type {ReadonlyArray<readonly [string, string]>} scoped name → repo-relative package dir */
const PACKAGES = [
  ['@deepseek-ai/cordis', 'vendor/cordis'],
  ['@deepseek-ai/schemastery', 'vendor/schemastery'],
  ['@deepseek-ai/dsh-client-ui-slots', 'packages/client/ui-slots'],
  ['@deepseek-ai/dsh-client-runtime', 'packages/client/runtime'],
  ['@deepseek-ai/dsh-client-locale', 'packages/client/locale'],
]

/**
 * Link one package dir unless a real (non-symlink) install already exists.
 * @param {string} name - scoped package name.
 * @param {string} rel - repo-relative package directory.
 */
function linkPackage(name, rel) {
  const target = resolve(repoRoot, rel)
  if (!existsSync(target)) throw new Error(`link-upstream: missing ${target} — pass the repo root as argv[1]`)
  const dest = join(pluginRoot, 'node_modules', name)
  mkdirSync(dirname(dest), { recursive: true })
  if (existsSync(dest)) {
    if (lstatSync(dest).isSymbolicLink()) rmSync(dest)
    else return // a real npm install wins over the source-plane link
  }
  symlinkSync(target, dest, 'dir')
  console.log(`linked ${name} -> ${rel}`)
}

/** Locate the checkout's @types/react inside the pnpm virtual store. */
function findReactTypes() {
  const store = join(repoRoot, 'node_modules', '.pnpm')
  const entry = readdirSync(store).find(d => /^@types\+react@18\./.test(d))
  if (entry === undefined) throw new Error('link-upstream: @types/react@18 not found in the checkout store')
  return join(store, entry, 'node_modules', '@types', 'react')
}

for (const [name, rel] of PACKAGES) linkPackage(name, rel)

// @types/react has no package dir of its own; borrow the checkout's copy.
const typesDest = join(pluginRoot, 'node_modules', '@types', 'react')
mkdirSync(dirname(typesDest), { recursive: true })
if (existsSync(typesDest) && !lstatSync(typesDest).isSymbolicLink()) {
  // a real npm install wins over the source-plane link
} else {
  rmSync(typesDest, { force: true, recursive: true })
  symlinkSync(findReactTypes(), typesDest, 'dir')
  console.log('linked @types/react -> checkout pnpm store')
}
