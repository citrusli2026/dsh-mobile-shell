/**
 * Shared prop contracts for the two mobile chrome entries: the injected
 * business face both receive and the composed four-share props aliases the
 * components consume (derived from their single sources, never re-typed).
 */
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { createMobileUiStore } from './stores.ts'
import type { MobileMode } from './mobile-mode.ts'
import type { NS } from './locales.ts'

/** Store seat type shared by both registrations (one apply-time handle). */
export type MobileUiStore = ReturnType<typeof createMobileUiStore>

// Structural SlotMap mirrors of the two upstream declarations this plugin
// contributes into: 'shell.overlay' (ui-layout) and 'conversation.input.dock'
// (ui-conversation). Mirrored locally because the ui-conversation npm type
// package is uninstallable today (it peers on the unpublished dsh-compact),
// and mirroring keeps the drift surface explicit: types are erased at build,
// so a mirror mismatch never changes runtime behavior — ctx.slots.inject
// degrades the entry to a no-op when the runtime declaration is absent, and
// a REAL upstream shape change is caught by comparing against the declaring
// packages' changelogs on upgrade. Mirror sources:
//   packages/client/ui-layout/src/client/index.ts        (2026-08-14)
//   packages/client/ui-conversation/src/client/contract/slots.ts (2026-08-14)
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Frame-wide floating layer (list, root scope); the drawer's seat. */
    'shell.overlay': { kind: 'list'; scope: 'root' }
    /**
     * Full-width row stacked above the composer card (list, session scope);
     * the strip's seat. Upstream owner is InputZone (point-in-time session /
     * input snapshots the strip does not read); mirrored as object.
     */
    'conversation.input.dock': { kind: 'list'; scope: 'session'; owner: object }
  }
}

/** Injected business face: apply-world callbacks plus the mobile-mode source. */
export interface MobileChromeInjected {
  hooks: {
    /** Reactive mobile-mode fact (active = viewport at/below the breakpoint). */
    mobileMode: HostObservable<MobileMode>
  }
  /** Open one session (the drawer closes itself through the shared store). */
  openSession: (id: SessionId) => void
  /** Start a new session, workspace-aware (the drawer's new-session row). */
  startSession: () => void
}

/** Input-dock strip props: session scope, shared store, inject face, locale seat. */
export type MobileStripProps =
  & PropsRuntime<'conversation.input.dock'>
  & PropsStore<MobileUiStore>
  & InjectFace<MobileChromeInjected>
  & PropsLocale<typeof NS>

/** Overlay drawer props: root scope, same store and face. */
export type SessionDrawerProps =
  & PropsRuntime<'shell.overlay'>
  & PropsStore<MobileUiStore>
  & InjectFace<MobileChromeInjected>
  & PropsLocale<typeof NS>
