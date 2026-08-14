#!/usr/bin/env node
/**
 * fix-spm-vendor — re-apply the vendored local-path dependency after
 * `cap sync ios`. Capacitor CLI regenerates CapApp-SPM/Package.swift on every
 * sync ("DO NOT MODIFY THIS FILE"), silently reverting the offline
 * `.package(path:)` edit back to the github.com remote (ADR-0005). This
 * script restores the vendored declaration so builds stay offline.
 *
 * Usage: node scripts/fix-spm-vendor.mjs   (run from anywhere; idempotent)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const manifest = path.join(root, 'app/ios/App/CapApp-SPM/Package.swift')
const REMOTE = '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.0")'
const LOCAL = '.package(path: "../../vendor/capacitor-swift-pm")'

const source = fs.readFileSync(manifest, 'utf8')
if (source.includes(LOCAL)) {
  console.log('fix-spm-vendor: already vendored, nothing to do')
} else if (source.includes(REMOTE)) {
  fs.writeFileSync(manifest, source.replace(REMOTE, `${LOCAL} // vendored (ADR-0005); restored by fix-spm-vendor — upstream was ${REMOTE}`))
  console.log('fix-spm-vendor: restored local-path dependency')
} else {
  console.error('fix-spm-vendor: Package.swift matches neither the upstream remote nor the vendored local declaration — inspect it by hand')
  process.exit(1)
}
