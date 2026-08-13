/**
 * dsh-mobile-ui, node half: the mobile UI overlay is browser-only, so this
 * entry exists for the host Loader to import the row and for the
 * client-modules scanner to see the package's dsh.client manifest. It
 * registers nothing on the host.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name. */
export const name = 'dsh-mobile-ui'

/** No host-side registrations: every contribution lives in the browser half. */
export function apply(_ctx: Context): void {}
