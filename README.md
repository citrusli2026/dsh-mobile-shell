# dsh-mobile-shell

English | [中文](README.zh.md)

A community, open-source **mobile shell** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) — a thin WebView app that connects your phone to your own self-hosted `dsh web` host, plus the token-guard reverse proxy that exposes that host to your LAN safely.

> **Not an official DeepSeek product.** This is a companion client built on the MIT-licensed upstream. The harness itself never runs on your phone: every tool execution (shell, files, terminal, LSP…) stays on your host, so the mobile app keeps **feature parity** with the desktop web UI by construction.

## What's in this repo

| Path | What it is |
|---|---|
| [`app/`](app/) | Capacitor 8 shell for Android & iOS: a pairing launcher (host + scoped device session, remembered), then the WebView loads the exact frontend your host serves — app and host versions never diverge |
| [`proxy/`](proxy/) | `dsh-remote`: a zero-dependency Node ≥20 reverse proxy. `dsh web` stays on loopback (upstream deliberately refuses `0.0.0.0`); the proxy owns network reachability, a constant-time token gate for every HTTP request and WebSocket handshake, and serves the launcher page itself (web mode, ADR-0007) |
| [`scripts/`](scripts/) | One-command secure LAN launcher plus verification tooling (launcher regression, real-dsh HTTP/HTTPS/WSS proxy matrix, and CDP-driven Android E2E) |
| [`docs/`](docs/) | Analysis, feasibility study, PoC runbook, and every design decision as ADRs |

The `dsh-mobile-ui` companion previously supplied mobile navigation chrome (bottom bar and session drawer) as an out-of-tree client plugin, but its former public repository is currently unavailable. Its in-repo recovery is now in the [deferred mobile backlog](docs/10-roadmap-to-release.md#8-androidios-后移-backlog). Do not follow old installation links until a version is pinned; the base shell and Web mode do not depend on it.

## Web artifact: for desktop and external hosts

The Web integration is isolated from the Capacitor projects. The root package script produces only the Node proxy, launcher, and QR module required at runtime; `app/android`, `app/ios`, native dependencies, and development tools are excluded:

```sh
cd dsh-mobile-shell
npm run package:web
# artifact: dist/web/
npm run verify:web
```

`dist/web/web-artifact.json` is the integration contract. It declares the `proxy`, `launcher`, and `pairing` entrypoints plus the artifact format version. Desktop consumers read the manifest instead of depending on this repository's source layout, so source changes can remain local to this repository. The directory can be released directly or archived:

```sh
tar -czf dist/dsh-mobile-shell-v1.0.0-web.tar.gz -C dist/web .
```

An external host starts `dsh web` on loopback and the artifact proxy as separate processes:

```sh
npx @deepseek-ai/dsh web --port 3080
DSH_REMOTE_TOKEN="$(openssl rand -hex 16)" \
DSH_TARGET_PORT=3080 \
node dist/web/start.mjs
```

The proxy listens on `0.0.0.0:3081` by default and serves the Web launcher, one-time pairing codes, and pairing URLs. Override it with `DSH_LISTEN_HOST`, `DSH_LISTEN_PORT`, `DSH_TARGET_HOST`, and `DSH_TARGET_PORT`. For public access also configure `DSH_TLS_CERT`, `DSH_TLS_KEY`, and a trusted `DSH_PUBLIC_URL`. Plain HTTP is for a trusted LAN or mesh network only; do not port-forward it.

For desktop integration, build `dist/web` in this repository first, then run `DSH_MOBILE_SHELL_WEB_ROOT=/absolute/path/dsh-mobile-shell/dist/web pnpm run build` in `dsh-desktop`. The Electron installer carries only this Web artifact; Android/iOS remain a separate release surface of this repository.

## Versioning

The current project version is `1.0.0`, declared once in the root `package.json`. The proxy package, Capacitor package, Android `versionName`, iOS `MARKETING_VERSION`, and Web artifact manifest are checked against it:

```sh
npm run verify:version
npm run package:web
```

Release tags use the `v<version>` form; validate one explicitly with `node scripts/verify-version.mjs v1.0.0` before publishing. Pushing a matching tag runs the Android, iOS, and Web builds and publishes all three assets. Existing historical tags are not rewritten.

## Quick start: start / scan / confirm

Run one command on the computer. It starts `dsh web` on loopback and the LAN proxy, selects one private LAN IPv4, generates a fresh random master token in memory, and prints an offline QR:

```sh
node scripts/start-lan.mjs
```

Then use exactly three steps:

1. **Start**: run the command and keep its terminal open.
2. **Scan**: connect the phone and computer to the same Wi-Fi, then scan the terminal QR.
3. **Confirm**: tap “确认配对并连接” once in the phone browser; the Harness opens.

The scan flow requires no IP, pairing-code, or token entry. The helper rejects public IPs, `0.0.0.0`, and inherited public/TLS configuration; if the computer has multiple LAN addresses, select one explicitly with `DSH_LAN_IP=192.168.1.23 node scripts/start-lan.mjs`. Plain HTTP is still for trusted LANs only—do not port-forward it.

Advanced users can start the host and proxy separately:

```sh
npx @deepseek-ai/dsh web --port 3080
DSH_REMOTE_TOKEN=$(openssl rand -hex 16) node proxy/dsh-remote.mjs
```

**On the phone** (same Wi-Fi) — App is also available:

- **Web mode (zero install, ADR-0007)**: scan the terminal QR. The browser opens the launcher, removes the scan fragment, and prefills the short code; confirm once to enter. The master token never leaves your computer.
- **App**: install the shell, enter `http://<computer-LAN-IP>:3081` and the pairing code (token entry remains as an advanced option). A remembered host gives one-tap reconnect.
  - **Android**: download the APK from [Releases](https://github.com/citrusli2026/dsh-mobile-shell/releases) and install directly.
  - **iOS**: build from source (below) or join TestFlight when available — Apple has no direct-install path for unsigned builds.

> **Web verification status (2026-08-15): passed.** The published `dsh web` completed the HTTP 28/28 and HTTPS/WSS 28/28 automated matrices. Playwright Chromium/WebKit plus mobile Chromium/WebKit passed the full flow: open QR deep link → explicit confirmation → land in DeepSeek Harness → reload with the session intact. The installed Google Chrome channel also passed 2/2. See the [Web hardening and verification report](docs/09-web-security-hardening.md). This result does not claim that physical Safari or the mobile app has completed its next verification stage.

## Build from source

```sh
git clone https://github.com/citrusli2026/dsh-mobile-shell.git
cd dsh-mobile-shell/app && npm install

# Android (JDK 17–21; Gradle downloads use mirror-friendly config, see docs)
cd android && ./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk

# iOS (Xcode; fully offline — the Capacitor SPM binaries are vendored and
# sha256-verified against upstream, see docs/decisions/ADR-0005)
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/build build
```

Slow downloads? China-mirror configurations for npm / Gradle / Maven / Node headers are collected in [docs/02-build-and-dependencies.md](docs/02-build-and-dependencies.md) §4.

## Security model — read before exposing anything

- The proxy authenticates every request and WS handshake and refuses to start without the host-only master secret `DSH_REMOTE_TOKEN`. Pairing issues a signed 30-day device session: browsers receive only an HttpOnly cookie, while the master secret never enters a response body, URL, or browser storage. Device sessions cannot mint more pairing codes, and authenticated cross-origin API/WS requests are rejected. Unauthenticated visitors see only the launcher page; disable it with `DSH_LAUNCHER=off` if you prefer a bare 401.
- **Plain HTTP by default**: use it on trusted LANs or mesh VPNs (Tailscale…) only. For public exposure, TLS is available but **you supply the certificate** (`DSH_TLS_CERT`/`DSH_TLS_KEY` — a domain cert from a real CA; self-signed is unusable in stock WebViews, see ADR-0006).
- The Android/iOS projects allow cleartext traffic for the LAN case; tighten both switches behind TLS (ADR-0004).

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | PoC: shell + token proxy, LAN verification on both emulators | ✅ done ([report](docs/05-phase1-poc.md)) |
| 2 | Pairing codes, optional TLS at the proxy | ✅ done ([report](docs/06-phase2-pairing-tls.md)) |
| Web | Zero-install browser flow, device sessions, and security hardening | ✅ done and E2E verified ([report](docs/09-web-security-hardening.md)) |
| 3 | Web QR pairing, full device lifecycle, management/deployment UX, and i18n | Web-first, in progress — [roadmap](docs/10-roadmap-to-release.md) |
| 4 | Android/iOS builds, signing, mobile UI, and physical-device release gates | deferred — [device checklist](docs/07-real-device-verification.md) |
| 5 | Push, a full offline shell, and other high-cost experience work | evaluate after Web is stable |

## Documentation

- [docs/README.md](docs/README.md) — full index: project analysis, build/dependency guide, feasibility study, PoC runbook
- [Web QR pairing report](docs/11-web-qr-pairing.md) — offline QR, deep-link behavior, and verification
- [docs/decisions/](docs/decisions/) — ADR-0001…0009, one per consequential choice

## License

[MIT](LICENSE). Vendored components (e.g. Capacitor's iOS binaries under `app/ios/vendor/`) keep their own licenses. DeepSeek Harness itself is MIT-licensed by DeepSeek AI.
