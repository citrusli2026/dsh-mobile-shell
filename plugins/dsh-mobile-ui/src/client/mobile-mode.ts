/**
 * Reactive mobile-mode fact: one bare observable (getSnapshot + subscribe)
 * over two media queries — the configured width breakpoint and the
 * coarse-pointer query. Snapshot identity is stable between fact changes so
 * the renderer's source-to-hook binding stays cached; listeners are disposed
 * with the plugin fiber.
 */

/** Mobile-mode facts; `active` is the breakpoint decision components read. */
export interface MobileMode {
  /** True while the viewport width is at or below the configured breakpoint. */
  readonly active: boolean
  /** Raw width-breakpoint fact (equals active today; separate for future density tiers). */
  readonly narrow: boolean
  /** Coarse-pointer (touch) fact; false where matchMedia is unavailable. */
  readonly coarse: boolean
}

/** Bare observable source consumed by the inject hooks compartment. */
export interface MobileModeSource {
  getSnapshot(): MobileMode
  subscribe(fn: () => void): () => void
  dispose(): void
}

/** Fixed posture for hosts without matchMedia (tests, SSR): desktop, zero listeners. */
const DESKTOP: MobileMode = { active: false, narrow: false, coarse: false }

/**
 * Create the mobile-mode source for one breakpoint.
 * @param breakpoint - viewport width in px at or below which mobile mode activates.
 * @returns the observable source and its disposer.
 */
export function createMobileMode(breakpoint: number): MobileModeSource {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { getSnapshot: () => DESKTOP, subscribe: () => () => {}, dispose: () => {} }
  }
  const width = window.matchMedia(`(max-width: ${breakpoint}px)`)
  const pointer = window.matchMedia('(pointer: coarse)')
  const compute = (): MobileMode => {
    const narrow = width.matches
    const coarse = pointer.matches
    return { active: narrow, narrow, coarse }
  }
  let snapshot = compute()
  const listeners = new Set<() => void>()
  const onChange = (): void => {
    const next = compute()
    if (next.active === snapshot.active && next.coarse === snapshot.coarse) return
    snapshot = next
    for (const fn of [...listeners]) fn()
  }
  width.addEventListener('change', onChange)
  pointer.addEventListener('change', onChange)
  return {
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    dispose: () => {
      width.removeEventListener('change', onChange)
      pointer.removeEventListener('change', onChange)
      listeners.clear()
    },
  }
}
