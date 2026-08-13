# dsh-mobile-ui

English | [中文](README.zh.md)

Mobile UI overlay for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI, packaged as an **out-of-tree client plugin** — no upstream source changes. It gives phone-sized viewports a usable navigation pattern that the desktop three-column shell does not provide.

## What it adds

- **Action strip above the composer** (session scope): a `会话 / Sessions` button that opens the session drawer — with a badge counting sessions currently blocked on an approval or question — and a `新会话 / New` button. Rendered only in mobile mode; desktop chrome is untouched.
- **Full-screen session drawer** (frame overlay): live session list in host order (blank placeholders hidden unless current), per-row status dots (pending / running / completed), the current session highlighted, and a new-session row. Closes on selection, backdrop tap, or its close button.
- **Mobile-mode detection**: `matchMedia` width breakpoint plus coarse-pointer fact, delivered to components as a reactive source. The breakpoint is a plugin `Config` field (default `768`, px).

Everything is additive: no slot occupant is replaced, no global CSS is written (component styles consume the theme's `--dsw-alias-*` semantic tokens), and both seats are waited on through `ctx.slots.inject`, so an upstream that stops declaring them degrades the plugin to a no-op instead of failing the boot.

## Install

Requires a `dsh` CLI (installed or a source checkout). Install into the shipped `web` profile:

```sh
dsh plugin --profile web add dsh-mobile-ui      # from npm / tarball / git
# or from a local checkout:
dsh plugin --profile web add ./dsh-mobile-ui
dsh --profile web
```

The profile's bundle list becomes `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-mobile-ui"]`; the mobile chrome appears on viewports at or below the breakpoint. Remove with `dsh plugin --profile web remove dsh-mobile-ui`.

## Configure

Override the row's `config` in your profile's `cordis.patch.yml` (later layer wins; restate the whole config):

```yaml
- id: ui-mobile
  config:
    breakpoint: 820   # px; min 320
```

## Develop

```sh
npm install                # build/test tooling (tsdown, vitest, …)
npm run link:upstream      # type-link a deepseek-harness checkout (argv[1] = repo root)
npm run typecheck          # strict tsc against the checkout's source plane
npm run build              # emit lib/index.js (node half) + lib/client.js (browser bundle)
npx vitest run             # component behavior specs
```

Notes:

- **`link:upstream` is required for typecheck only.** Several `@deepseek-ai/*` npm packages are uninstallable today (they depend on unpublished names such as `dsh-compact`), so contract types come from a repository checkout via symlinks. npm installs prune those symlinks — re-run `link:upstream` after any install. Build and install do not need the links.
- The browser bundle is a closure factory for the harness module table: externals are the platform modules (`react`, `@deepseek-ai/cordis`, `dsh-client-ui-slots`, …) plus `dsh-client-runtime/client`; everything else inlines. The purity gate in `tsdown.config.ts` rejects cross-plugin value imports.
- The two SlotMap entries consumed (`shell.overlay`, `conversation.input.dock`) are mirrored structurally in `src/client/contract.ts` with their upstream declaration sources; compare on upgrade.

## Model Experience

None. The plugin renders existing client object-layer state (session list, selection, pending-interaction flags) and issues navigation actions; nothing it shows or sends reaches a model request, so it adds no session events and no prompt tokens.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known limitations

- **Details panel stays unreachable on phones** — the layout concession chain force-closes it below ~996px and that geometry is contract-frozen in `ui-layout` (upstream source). Tool details remain visible inside chat rows.
- **No strip on the no-session hero page** — the strip's seat is session-scoped; with no current session use the desktop rail or start a session first.
- **Component-internal density is out of scope** — restyling existing components (composer, tool cards, trajectory table) belongs to their packages' CSS Modules and the theme tokens; an out-of-tree plugin cannot and does not touch them. Track upstream for those refinements.
- **Typecheck requires a repository checkout** until the upstream type packages install cleanly from npm.
