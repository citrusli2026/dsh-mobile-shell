/**
 * dsh-mobile-ui, browser half: mobile chrome for the Web GUI — an in-flow
 * action strip docked above the composer (conversation.input.dock) and a
 * full-screen session drawer in the frame overlay (shell.overlay). Additive
 * only: no slot occupant is replaced, no global style is written, and all
 * panel orchestration goes through ctx services. Both seats are waited on
 * through ctx.slots.inject, so an upstream that has not declared them yet —
 * or stops declaring them — degrades this plugin to a no-op instead of
 * failing the boot.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only Context merges; erased at build (bundle purity gate). SlotMap
// entries are structural mirrors in contract.ts (see the note there).
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createMobileMode } from './mobile-mode.ts'
import { createMobileUiStore } from './stores.ts'
import type { MobileChromeInjected } from './contract.ts'
import { MobileStrip } from './MobileStrip.tsx'
import { SessionDrawer } from './SessionDrawer.tsx'
import { en, NS, zh } from './locales.ts'

/** Cordis plugin name. */
export const name = 'dsh-mobile-ui'

/** Required services: slot registry, session/workspace object layer, dictionaries. */
export const inject = ['slots', 'sessions', 'workspaces', 'locale']

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Viewport width in px at or below which mobile mode activates (default 768). */
  breakpoint?: number
}

export const Config: z<Config> = z.object({
  breakpoint: z.number().step(1).min(320).default(768),
})

/**
 * Mount the mobile chrome: dictionaries, the mobile-mode source, the shared
 * store, then one strip and one drawer registration behind slot-declaration
 * injection.
 * @param ctx - client root context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery's .default() guarantees the field is set after validation.
  const mode = createMobileMode(config.breakpoint as number)
  ctx.effect(() => () => { mode.dispose() }, 'dsh-mobile-ui: mobile-mode media listeners')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mobile-ui: dictionaries')

  const store = createMobileUiStore()
  const face: MobileChromeInjected = {
    hooks: { mobileMode: mode },
    openSession: (id) => { ctx.sessions.open(id) },
    startSession: () => { ctx.workspaces.startSession() },
  }

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'mobile-strip',
    order: 100,
    locale: NS,
    store,
    inject: () => face,
  }, MobileStrip))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'mobile-session-drawer',
    order: 100,
    locale: NS,
    store,
    inject: () => face,
  }, SessionDrawer))
}
