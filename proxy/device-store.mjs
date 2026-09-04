/**
 * Device registry for dsh-remote (roadmap W2).
 *
 * Persistent, versioned record of issued device sessions: id, name, issue /
 * expiry / revocation timestamps and last use. Bearer secrets are never
 * stored — a device token is self-standing (HMAC over its payload), the
 * registry only answers "is this device id still valid?".
 *
 * Durability contract:
 *   - writes go to `<path>.tmp` then `rename()` (atomic replace), file mode 0600
 *   - a state file that exists but cannot be parsed fails closed: the caller
 *     refuses to issue or accept device sessions until the file is removed
 *     (removing it revokes every device — recovery is re-pairing)
 */
import fs from 'node:fs'

export const STATE_VERSION = 1

/** @returns {{version: number, devices: Array<object>}} */
export function emptyState() {
  return { version: STATE_VERSION, devices: [] }
}

/** Load and validate the registry. Throws on a corrupt file (fail closed). */
export function loadState(path) {
  let raw
  try {
    raw = fs.readFileSync(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState()
    throw new Error(`device state ${path} is unreadable: ${error.message}`)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`device state ${path} is corrupt (invalid JSON); remove the file to revoke all devices, then re-pair`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
      || parsed.version !== STATE_VERSION || !Array.isArray(parsed.devices)) {
    throw new Error(`device state ${path} has an unsupported format; remove the file to revoke all devices, then re-pair`)
  }
  for (const device of parsed.devices) {
    if (typeof device?.id !== 'string' || device.id.length === 0
        || !Number.isSafeInteger(device?.expiresAt)) {
      throw new Error(`device state ${path} contains a malformed device record; remove the file to revoke all devices, then re-pair`)
    }
  }
  return parsed
}

/** Atomic replace: 0600 temp file in the same directory, then rename. */
export function saveState(path, state) {
  const payload = JSON.stringify(state, null, 2)
  const tmp = `${path}.tmp`
  const fd = fs.openSync(tmp, 'w', 0o600)
  try {
    fs.writeFileSync(fd, payload)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, path)
}

/** Drop expired records; returns true when the state changed. */
export function pruneExpired(state, now = Date.now()) {
  const before = state.devices.length
  state.devices = state.devices.filter((device) => device.expiresAt > now)
  return state.devices.length !== before
}

/** Register a freshly minted device and persist. Returns the record. */
export function registerDevice(state, path, { id, name, issuedAt, expiresAt }) {
  const record = {
    id,
    name: String(name ?? '').slice(0, 64) || defaultDeviceName(issuedAt),
    issuedAt,
    expiresAt,
    revokedAt: null,
    lastSeenAt: null,
  }
  state.devices.push(record)
  saveState(path, state)
  return record
}

/** A device id is accepted only when registered, unrevoked and unexpired. */
export function deviceActive(state, id, now = Date.now()) {
  const record = state.devices.find((device) => device.id === id)
  if (!record) return undefined
  if (record.revokedAt !== null || record.expiresAt <= now) return undefined
  return record
}

export function revokeDevice(state, path, id, now = Date.now()) {
  const record = state.devices.find((device) => device.id === id)
  if (!record || record.revokedAt !== null) return false
  record.revokedAt = now
  saveState(path, state)
  return true
}

/** Public view of a record: never includes secrets (there are none stored). */
export function publicView(record) {
  const { id, name, issuedAt, expiresAt, revokedAt, lastSeenAt } = record
  return { id, name, issuedAt, expiresAt, revokedAt, lastSeenAt }
}

function defaultDeviceName(issuedAt) {
  const date = new Date(issuedAt)
  const pad = (n) => String(n).padStart(2, '0')
  return `设备 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
