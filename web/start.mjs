#!/usr/bin/env node
/**
 * Start the Web artifact's LAN proxy. The dsh host is intentionally managed
 * by the caller and remains an independent process.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const artifactRoot = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'web-artifact.json'), 'utf8'))
const proxyPath = path.resolve(artifactRoot, manifest.entrypoints.proxy)
const launcherPath = path.resolve(artifactRoot, manifest.entrypoints.launcher)

if (process.env.DSH_LAUNCHER === undefined) process.env.DSH_LAUNCHER = launcherPath
await import(pathToFileURL(proxyPath).href)
