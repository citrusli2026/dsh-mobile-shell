// @vitest-environment jsdom
/**
 * MobileStrip behavior: renders only in mobile mode, carries the
 * pending-interaction count badge, and wires both buttons to the injected
 * face. Props are fed directly (the sanctioned zero-machinery path).
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileStripProps } from '../src/client/contract.ts'
import { MobileStrip } from '../src/client/MobileStrip.tsx'

afterEach(cleanup)

/** Minimal props builder: only the members the component reads are real. */
function makeProps(overrides: {
  active?: boolean
  pending?: number
  setDrawerOpen?: (open: boolean) => void
  startSession?: () => void
}): MobileStripProps {
  const { active = true, pending = 0, setDrawerOpen = () => {}, startSession = () => {} } = overrides
  const listState = {
    ids: ['a', 'b'],
    byId: {
      a: { id: 'a', displayTitle: 'Alpha', blank: false, running: false, updatedAt: 0, ...(pending > 0 ? { pendingInteraction: { kind: 'approval' } } : {}) },
      b: { id: 'b', displayTitle: 'Beta', blank: false, running: true, updatedAt: 0 },
    },
    current: 'a',
  }
  return {
    useMobileMode: (sel: (s: { active: boolean }) => unknown) => sel({ active }),
    useSessions: (sel: (s: unknown) => unknown) => sel(listState),
    actions: { setDrawerOpen },
    startSession,
    t: (key: string) => key,
  } as unknown as MobileStripProps
}

describe('MobileStrip', () => {
  it('renders nothing outside mobile mode', () => {
    const { container } = render(<MobileStrip {...makeProps({ active: false })} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the sessions and new buttons in mobile mode, badge only when pending', () => {
    const { getByText, queryByText } = render(<MobileStrip {...makeProps({ pending: 1 })} />)
    expect(getByText('strip.sessions')).toBeTruthy()
    expect(getByText('strip.new')).toBeTruthy()
    expect(queryByText('1')).toBeTruthy()
  })

  it('omits the badge when nothing is pending', () => {
    const { queryByText } = render(<MobileStrip {...makeProps({ pending: 0 })} />)
    expect(queryByText('0')).toBeNull()
  })

  it('opens the drawer and starts a session from the buttons', () => {
    const setDrawerOpen = vi.fn()
    const startSession = vi.fn()
    const { getByText } = render(<MobileStrip {...makeProps({ setDrawerOpen, startSession })} />)
    fireEvent.click(getByText('strip.sessions'))
    fireEvent.click(getByText('strip.new'))
    expect(setDrawerOpen).toHaveBeenCalledWith(true)
    expect(startSession).toHaveBeenCalledTimes(1)
  })
})
