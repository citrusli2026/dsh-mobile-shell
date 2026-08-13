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
    // LAN hosts are plain HTTP until phase 2 adds TLS at the proxy (ADR-0004).
    // http scheme keeps the launcher origin non-secure so healthz fetches to
    // http:// hosts are not blocked as mixed content.
    androidScheme: 'http',
    cleartext: true,
    // The whole point of the shell: the WebView must load the user-specified
    // dsh host origin instead of handing it to the system browser. Users
    // connect to arbitrary self-hosted addresses, so the allowlist is a
    // wildcard — the token gate at dsh-remote is the trust boundary.
    allowNavigation: ['*'],
  },
  ios: {
    contentInset: 'never',
  },
}

export default config
