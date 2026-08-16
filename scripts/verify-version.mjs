#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
const readJson = (relativePath) => JSON.parse(read(relativePath))

const rootVersion = readJson('package.json').version
if (!/^\d+\.\d+\.\d+$/.test(rootVersion)) {
  throw new Error(`invalid root version: ${rootVersion}`)
}

for (const relativePath of ['proxy/package.json', 'app/package.json']) {
  const version = readJson(relativePath).version
  if (version !== rootVersion) {
    throw new Error(`${relativePath} version ${version} does not match root ${rootVersion}`)
  }
}

const android = read('app/android/app/build.gradle')
const androidVersion = /versionName\s+"([^"]+)"/.exec(android)?.[1]
if (androidVersion !== rootVersion) {
  throw new Error(`Android version ${androidVersion ?? '(missing)'} does not match root ${rootVersion}`)
}

const ios = read('app/ios/App/App.xcodeproj/project.pbxproj')
const iosVersions = [...ios.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((match) => match[1].trim())
if (iosVersions.length === 0 || iosVersions.some((version) => version !== rootVersion)) {
  throw new Error(`iOS versions ${JSON.stringify(iosVersions)} do not match root ${rootVersion}`)
}

const tag = process.argv[2]
if (tag !== undefined && tag !== `v${rootVersion}`) {
  throw new Error(`release tag ${tag} does not match v${rootVersion}`)
}

console.log(`ok   project version ${rootVersion}`)
console.log(`ok   package, Android, and iOS versions are synchronized`)
if (tag !== undefined) console.log(`ok   release tag ${tag} matches project version`)
