/**
 * Mobile chrome viewing-state store: the drawer open bit shared by the
 * composer strip entry and the overlay drawer entry (one apply-time handle
 * passed to both registrations). Transient by contract — no persist key; a
 * reload restores drawer-closed, matching the layout store's geometry
 * posture.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Shared mobile chrome state. */
export interface MobileUiState {
  drawerOpen: boolean
}

/** Declared write surface (draft-transform actions). */
type MobileUiActions = {
  setDrawerOpen: (draft: MobileUiState, open: boolean) => void
}

/**
 * Declare the shared store.
 * @returns the store handle passed to both slot registrations.
 */
export function createMobileUiStore(): EngineStoreHandle<MobileUiState, MobileUiActions> {
  return defineStore({
    init: (): MobileUiState => ({ drawerOpen: false }),
    actions: {
      setDrawerOpen: (d, open: boolean) => { d.drawerOpen = open },
    },
  })
}
