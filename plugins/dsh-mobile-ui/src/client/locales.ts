/**
 * Mobile UI copy: zh is the product language, en the mirror. The
 * LocaleNamespaceMap merge lets registrations declare `locale: NS` and hands
 * components the typed framework `t` seat.
 */

/** Dictionary namespace id (LocaleNamespaceMap key). */
export const NS = 'mobileUi'

/** Chinese dictionary (source of the key union). */
export const zh = {
  'strip.sessions': '会话',
  'strip.new': '新会话',
  'drawer.title': '会话列表',
  'drawer.close': '关闭',
  'drawer.empty': '还没有会话',
  'drawer.new': '新会话',
} as const

/** Dictionary key union of the mobileUi namespace. */
export type MobileUiKey = keyof typeof zh

/** English mirror dictionary. */
export const en: Record<MobileUiKey, string> = {
  'strip.sessions': 'Sessions',
  'strip.new': 'New',
  'drawer.title': 'Sessions',
  'drawer.close': 'Close',
  'drawer.empty': 'No sessions yet',
  'drawer.new': 'New session',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Mobile chrome copy (action strip + session drawer). */
    mobileUi: MobileUiKey
  }
}
