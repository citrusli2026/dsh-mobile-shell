# dsh-mobile-shell

English | [中文](README.zh.md)

A community, open-source **mobile shell** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) — a thin WebView app that connects your phone to your own self-hosted `dsh web` host, plus the token-guard reverse proxy that exposes that host to your LAN safely.

> **Not an official DeepSeek product.** This is a companion client built on the MIT-licensed upstream. The harness itself never runs on your phone: every tool execution (shell, files, terminal, LSP…) stays on your host, so the mobile app keeps **feature parity** with the desktop web UI by construction.

## What's in this repo

| Path | What it is |
|---|---|
| [`app/`](app/) | Capacitor 8 shell for Android & iOS: a pairing launcher (host + token, remembered), then the WebView loads the exact frontend your host serves — app and host versions never diverge |
| [`proxy/`](proxy/) | `dsh-remote`: a zero-dependency Node ≥20 reverse proxy. `dsh web` stays on loopback (upstream deliberately refuses `0.0.0.0`); the proxy owns network reachability and a constant-time token gate for every HTTP request and WebSocket handshake |
| [`scripts/`](scripts/) | Verification tooling (CDP-driven Android E2E, proxy smoke matrix) |
| [`docs/`](docs/) | Analysis, feasibility study, PoC runbook, and every design decision as ADRs |

Companion plugin: [`dsh-mobile-ui`](https://github.com/citrusli2026/dsh-mobile-ui) — mobile navigation chrome (bottom bar, session drawer) as an out-of-tree client plugin for the host's web UI. The shell works without it; the plugin works without the shell.

## Quick start

**1. On your computer** — start the host and the proxy:

```sh
npx @deepseek-ai/dsh web --port 3080          # the harness, loopback as usual
DSH_REMOTE_TOKEN=$(openssl rand -hex 16) node proxy/dsh-remote.mjs
# dsh-remote: http://0.0.0.0:3081 -> http://127.0.0.1:3080 (token required)
# dsh-remote: pairing code 847291 — single use, expires in 10 min
```

**2. On your phone** (same Wi-Fi) — install the app, enter `http://<computer-LAN-IP>:3081` and the printed **pairing code** (the master token never leaves your computer; token entry remains as an advanced option):

- **Android**: download the APK from [Releases](../../releases) and install directly.
- **iOS**: build from source (below) or join TestFlight when available — Apple has no direct-install path for unsigned builds.

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

- The token is the only authentication; the proxy enforces it on every request and WS handshake, and refuses to start without `DSH_REMOTE_TOKEN`.
- **Plain HTTP in the current PoC**: use it on trusted LANs or mesh VPNs (Tailscale…) only. Do not expose the proxy port to the public internet before TLS lands (phase 2, see roadmap).
- The Android/iOS projects allow cleartext traffic for the same reason; both switches must be tightened when TLS arrives (ADR-0004).

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | PoC: shell + token proxy, LAN verification on both emulators | ✅ done ([report](docs/05-phase1-poc.md)) |
| 2 | TLS at the proxy, QR-code pairing, upstream auth PR | planned |
| 3 | Mobile UI polish (via `dsh-mobile-ui`), offline bundled assets, TestFlight / stores | in progress |

## Documentation

- [docs/README.md](docs/README.md) — full index: project analysis, build/dependency guide, feasibility study, PoC runbook
- [docs/decisions/](docs/decisions/) — ADR-0001…0005, one per consequential choice

## License

[MIT](LICENSE). Vendored components (e.g. Capacitor's iOS binaries under `app/ios/vendor/`) keep their own licenses. DeepSeek Harness itself is MIT-licensed by DeepSeek AI.
