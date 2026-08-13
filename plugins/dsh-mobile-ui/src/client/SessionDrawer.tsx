/**
 * Full-screen session drawer in the frame overlay: the mobile replacement
 * for the desktop sidebar's session navigation. The panel renders only while
 * the shared store bit says open and mobile mode is active; rows come from
 * the global session hook in host order; the drawer closes on selection, on
 * the new-session action, on a backdrop tap, or on its close button. The
 * shell overlay layer is click-through, so the backdrop opts back into
 * pointer events only while mounted.
 */
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionDrawerProps } from './contract.ts'
import css from './SessionDrawer.module.css'

/** Reference-stable row list: host order, blank placeholders hidden unless current. */
function selectRows(state: SessionListState): readonly SessionSummary[] {
  const rows: SessionSummary[] = []
  for (const id of state.ids) {
    const row = state.byId[id]
    if (row === undefined) continue
    if (row.blank && row.id !== state.current) continue
    rows.push(row)
  }
  return rows
}

/** Element-wise identity compare keeps drawer renders quiet on unrelated list churn. */
function sameRows(a: readonly SessionSummary[], b: readonly SessionSummary[]): boolean {
  return a.length === b.length && a.every((row, i) => row === b[i])
}

/** Last path segment of a session cwd for the row subtitle. */
function cwdName(cwd: string | undefined): string {
  if (cwd === undefined) return ''
  const parts = cwd.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? cwd
}

/** Overlay drawer (root scope; panel mounted only while open in mobile mode). */
export function SessionDrawer({ useStore, useMobileMode, useSessions, actions, openSession, startSession, t }: SessionDrawerProps) {
  const open = useStore(s => s.drawerOpen)
  const active = useMobileMode(s => s.active)
  const rows = useSessions(selectRows, sameRows)
  const current = useSessions(s => s.current)
  if (!active || !open) return null
  const close = (): void => actions.setDrawerOpen(false)
  return (
    <div className={css.backdrop} onClick={close}>
      <nav className={css.panel} onClick={e => e.stopPropagation()} aria-label={t('drawer.title')}>
        <div className={css.header}>
          <span className={css.title}>{t('drawer.title')}</span>
          <button type="button" className={css.closeButton} onClick={close}>
            {t('drawer.close')}
          </button>
        </div>
        <button
          type="button"
          className={css.newButton}
          onClick={() => {
            startSession()
            close()
          }}
        >
          {t('drawer.new')}
        </button>
        <div className={css.list}>
          {rows.length === 0 && <div className={css.empty}>{t('drawer.empty')}</div>}
          {rows.map(row => (
            <button
              key={row.id}
              type="button"
              className={row.id === current ? css.rowCurrent : css.row}
              onClick={() => {
                openSession(row.id)
                close()
              }}
            >
              <span
                className={
                  row.pendingInteraction !== undefined ? css.dotPending
                    : row.running ? css.dotRunning
                    : row.completed === true ? css.dotCompleted
                    : css.dotIdle
                }
              />
              <span className={css.rowText}>
                <span className={css.rowTitle}>{row.displayTitle}</span>
                {row.cwd !== undefined && <span className={css.rowSubtitle}>{cwdName(row.cwd)}</span>}
              </span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
