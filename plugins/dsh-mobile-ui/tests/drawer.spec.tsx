// @vitest-environment jsdom
/**
 * SessionDrawer behavior: blank sessions hidden unless current, selection
 * opens the session and closes the drawer, backdrop and close button dismiss,
 * and the drawer renders nothing when closed or outside mobile mode.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionDrawerProps } from '../src/client/contract.ts'
import { SessionDrawer } from '../src/client/SessionDrawer.tsx'

afterEach(cleanup)

/** Minimal props builder over three rows: normal, blank, and blank-but-current. */
function makeProps(overrides: {
  open?: boolean
  active?: boolean
  setDrawerOpen?: (open: boolean) => void
  openSession?: (id: string) => void
}): SessionDrawerProps {
  const { open = true, active = true, setDrawerOpen = () => {}, openSession = () => {} } = overrides
  const listState = {
    ids: ['a', 'b', 'c'],
    byId: {
      a: { id: 'a', displayTitle: 'Alpha', cwd: '/work/alpha', blank: false, running: true, updatedAt: 0 },
      b: { id: 'b', displayTitle: 'Beta', blank: true, running: false, updatedAt: 0 },
      c: { id: 'c', displayTitle: 'New Session', blank: true, running: false, updatedAt: 0 },
    },
    current: 'c',
  }
  return {
    useStore: (sel: (s: { drawerOpen: boolean }) => unknown) => sel({ drawerOpen: open }),
    useMobileMode: (sel: (s: { active: boolean }) => unknown) => sel({ active }),
    useSessions: (sel: (s: unknown) => unknown, _eq?: unknown) => sel(listState),
    actions: { setDrawerOpen },
    openSession: openSession as SessionDrawerProps['openSession'],
    startSession: () => {},
    t: (key: string) => key,
  } as unknown as SessionDrawerProps
}

describe('SessionDrawer', () => {
  it('renders nothing when closed or outside mobile mode', () => {
    expect(render(<SessionDrawer {...makeProps({ open: false })} />).container.firstChild).toBeNull()
    expect(render(<SessionDrawer {...makeProps({ active: false })} />).container.firstChild).toBeNull()
  })

  it('lists non-blank sessions plus the current blank one', () => {
    const { getByText, queryByText } = render(<SessionDrawer {...makeProps({})} />)
    expect(getByText('Alpha')).toBeTruthy()
    expect(queryByText('Beta')).toBeNull()
    expect(getByText('New Session')).toBeTruthy()
    expect(getByText('alpha')).toBeTruthy()
  })

  it('opens a session and closes on row click', () => {
    const openSession = vi.fn()
    const setDrawerOpen = vi.fn()
    const { getByText } = render(<SessionDrawer {...makeProps({ openSession, setDrawerOpen })} />)
    fireEvent.click(getByText('Alpha'))
    expect(openSession).toHaveBeenCalledWith('a')
    expect(setDrawerOpen).toHaveBeenCalledWith(false)
  })

  it('closes from the close button and from a backdrop tap', () => {
    const setDrawerOpen = vi.fn()
    const { getByText, container } = render(<SessionDrawer {...makeProps({ setDrawerOpen })} />)
    fireEvent.click(getByText('drawer.close'))
    fireEvent.click(container.firstChild as Element)
    expect(setDrawerOpen).toHaveBeenCalledTimes(2)
    expect(setDrawerOpen).toHaveBeenNthCalledWith(1, false)
    expect(setDrawerOpen).toHaveBeenNthCalledWith(2, false)
  })
})
