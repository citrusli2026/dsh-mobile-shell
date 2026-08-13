import type { CapacitorConfig } from '@capacitor/cli'

/**
 * dsh-mobile shell: the bundled www/ holds only the launcher page. After the
 * user pairs with a host, the launcher navigates the WebView to the remote
 * `dsh web` origin (via the token proxy), so the app always runs the exact
 * frontend the host serves — frontend and backend versions never diverge.
 */
const config: CapacitorConfig = {
  appId: 'com.dshmobile.app',
  appName: 'DSH',
  webDir: 'www',
  server: {
    // LAN hosts are plain HTTP until phase 2 adds TLS at the proxy.
    cleartext: true,
  },
  ios: {
    contentInset: 'never',
  },
}

export default config
