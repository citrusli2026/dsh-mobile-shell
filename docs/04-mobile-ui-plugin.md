# 04 移动 UI 插件（dsh-mobile-ui）：实施与验证

本文记录阶段 3"移动体验"缺口的首个交付：树外客户端插件 `dsh-mobile-ui` 的实现内容与端到端验证结果。决策依据见 [ADR-0003](decisions/ADR-0003-mobile-ui-out-of-tree-plugin.md)；上游契约论断均标注文件路径，可复核。

## 1. 交付物

位置：`mobile/plugins/dsh-mobile-ui/`（独立 npm 包，不入 pnpm workspace，未来随 `dsh-mobile` 独立仓库迁移）。

| 内容 | 文件 |
|---|---|
| 双面包 manifest（`dsh.bundle` + `dsh.client`） | `package.json` |
| bundle 层（插入 `ui-mobile` 行） | `cordis.patch.yml` |
| 独立构建配置（复刻 harness 客户端 bundle 契约：平台外链、纯度门禁、CSS Modules 注入、模块表 banner/footer） | `tsdown.config.ts` |
| node 半（空 apply，供 host Loader 导入） | `src/index.ts` |
| 移动模式检测（matchMedia 裸可观察源，断点为 Config 字段，默认 768px） | `src/client/mobile-mode.ts` |
| 操作条（`conversation.input.dock`，会话流内、无遮挡） | `src/client/MobileStrip.tsx` |
| 会话抽屉（`shell.overlay`，全屏） | `src/client/SessionDrawer.tsx` |
| 共享抽屉状态 store / 注入面与 SlotMap 结构镜像 | `src/client/stores.ts`、`src/client/contract.ts` |
| 中英文字典（`mobileUi` 命名空间） | `src/client/locales.ts` |
| 行为测试（vitest + jsdom，8 例） | `tests/strip.spec.tsx`、`tests/drawer.spec.tsx` |
| 类型链接脚本（源码面类型解析） | `scripts/link-upstream.mjs` |

机制要点（全部为上游已声明契约）：

- 组合只走 `ctx.slots.register`；两个槽位都经 `ctx.slots.inject` 等待声明（`packages/client/runtime/README.md` §slot-declaration-injection），上游不再声明时插件静默降级。
- 会话数据来自框架全局座位钩子 `useSessions`/`useWorkspaces`（`packages/client/runtime/src/client/index.ts` GlobalStandardProps）；动作经 `ctx.sessions.open` / `ctx.workspaces.startSession`。
- 样式只消费 `--dsw-alias-*` 语义令牌（`docs/web-styling.md` 所有权规则），无全局 CSS、无字面色值。
- 浏览器 bundle 外链仅 `react/jsx-runtime` 与 `@deepseek-ai/dsh-client-runtime/client`（均在模块表，见 `packages/client/tsdown.client.ts` CLIENT_EXTERNALS）。

## 2. 过程中发现的两个上游事实（影响所有树外客户端插件）

1. **类型包无法从 npm 安装**：`@deepseek-ai/dsh-client-ui-conversation` 等 npm 包声明了对未发布名字（`dsh-compact`、`dsh-type-meta`、`dsh-user-interaction`）的依赖，npm 404。规避：类型检查链接仓库检出的源码面（`scripts/link-upstream.mjs`)；槽位条目以结构镜像声明（`contract.ts`，含出处与漂移说明）。构建/安装不受影响。
2. **`dsh plugin add` 对 in-box bundle 也走 pnpm**：`add @deepseek-ai/dsh-web-app` 会因未发布的 `dsh-code-runtime-worker` 失败；in-box 解析只发生在 boot。正确路径是用带模板名的 profile（`web`/`headless`)，模板在首次使用时初始化（`packages/boot/app-boot/src/profile.ts` PROFILE_TEMPLATES），只对树外包执行 `dsh plugin add`。

## 3. 验证结果（2026-08-14，macOS arm64，Node 24）

| 检查 | 命令 | 结果 |
|---|---|---|
| 严格类型检查 | `npm run typecheck`(tsc strict，链接源码面） | 通过，0 错误 |
| 行为测试 | `npx vitest run` | 2 文件 8 例全过 |
| 构建 | `npm run build`(tsdown) | `lib/index.js` 0.22kB + `lib/client.js` 46.47kB(+map)；外链仅两个模块表条目 |
| 安装链 | `dsh plugin --profile web add ./mobile/plugins/dsh-mobile-ui`（隔离 `DSH_HOME=tmp/dsh-home`，镜像源） | profile 初始化为 `[dsh-base, dsh-web-app]`，插件 link 并追加到 bundles |
| 组合 | `dsh --profile web --dump-config` | 出现 `# == dsh-mobile-ui` 层与 `ui-mobile` 行 |
| 端到端伺服 | `dsh --profile web --port 4183` 启动后 curl | 首页 boot graph 含 `dsh-mobile-ui/client.js?rev=<hash>`;`GET /plugins/dsh-mobile-ui/client.js` 返回 200 且字节数与构建产物一致（46471B)。验证后已关停服务 |

未覆盖项（诚实声明）：浏览器内真实渲染未自动化（无浏览器驱动）；组件行为由 jsdom 测试覆盖，槽位装配由类型检查与运行时降级机制兜底。真机/窄窗口人工走查列入后续任务。

## 4. 已知限制

见插件 README（[en](https://github.com/citrusli2026/dsh-mobile-ui#known-limitations) / [zh](https://github.com/citrusli2026/dsh-mobile-ui/blob/main/README.zh.md#已知限制))。要点：详情面板移动端不可达（布局冻结几何，需上游改动）;Hero 页无操作条（会话作用域座位）；存量组件内部密度属上游 PR 轨道，与本插件并行。

## 5. 后续任务

1. 真机/浏览器窄窗口人工走查（会话切换、审批应答、抽屉手势、安全区）。
2. Capacitor PoC(ADR-0002 阶段 1）联调本插件。
3. 视使用反馈评估 v2：抽屉加工作区分组、详情面板的移动出路（替换型槽位，需另起 ADR)、上游组件级响应式 PR。
