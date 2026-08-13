/**
 * Mobile action strip: a full-width row docked above the composer card (the
 * conversation.input.dock seat — in normal flow, so nothing is overlaid).
 * Renders only in mobile mode; desktop keeps the shipped chrome. The
 * sessions button opens the drawer through the shared store and carries a
 * pending-interaction count badge so blocked sessions stay visible on a
 * small screen.
 */
import type { MobileStripProps } from './contract.ts'
import css from './MobileStrip.module.css'

/** Strip docked above the composer (session scope; mobile mode only). */
export function MobileStrip({ useMobileMode, useSessions, actions, startSession, t }: MobileStripProps) {
  const active = useMobileMode(s => s.active)
  const pendingCount = useSessions(s =>
    s.ids.reduce((n, id) => (s.byId[id]?.pendingInteraction !== undefined ? n + 1 : n), 0))
  if (!active) return null
  return (
    <div className={css.strip}>
      <button type="button" className={css.button} onClick={() => actions.setDrawerOpen(true)}>
        {t('strip.sessions')}
        {pendingCount > 0 && <span className={css.badge}>{pendingCount}</span>}
      </button>
      <button type="button" className={css.button} onClick={startSession}>
        {t('strip.new')}
      </button>
    </div>
  )
}
