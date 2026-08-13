# ADR-0003 移动 UI：树外客户端插件，不改上游源码

- 状态：已接受（2026-08-14）
- 依据：[03-feasibility-analysis.md](../03-feasibility-analysis.md) 第 3 节缺口三；上游槽系统与样式所有权契约

## 背景

可行性文档把"移动 UI 适配"列为路线 A 的第三个缺口，原建议"作为上游 PR 推进"。需求方裁定：移动 UI 以**插件**实现，不改上游源码，上游源码仅作参考，且方案必须能承受上游演进（开发者预览期，声明有破坏性变更）。

上游契约事实（本轮源码核查）：

- 客户端 UI 只通过 `ctx.slots.register({ name, children?, store?, inject? }, Component)` 组合；`shell.overlay` 是框架级浮层的**追加型**槽位（list 类型），专为"badge / toast / 状态 pill"类平行条目设计。
- `ctx.layout` 服务对外暴露 `toggleSidebar / openDetails / closeDetails`；面板几何常量（CENTER_MIN 640 等）为契约冻结值，树外不可调。
- 样式所有权：全局样式与 `--dsw-*` 令牌归 `ui-theme`，组件样式归各自 CSS Modules；第三方包不得写全局覆盖（CSS Modules 类名为内容哈希，外部覆盖既违规又随上游构建漂移）。
- 树外 `dsh.client` 双面包可行：modules 节点半扫描 Loader 活条目并 `require.resolve` 包名，与是否在工作区内无关；浏览器端模块表对外部包回答 8 个平台模块 + `dsh-client-runtime/client` 豁免。
- 安装链：`dsh.bundle` manifest + `dsh plugin --profile <name> add`，与 ADR-0002 的"对接 npm release、不追 main"版本策略一致。

## 决策

1. **形态**：移动 UI 做成树外 `dsh.client` 插件包 `dsh-mobile-ui`（`mobile/plugins/dsh-mobile-ui/`），带 `dsh.bundle` manifest，经 profile 安装，不改 `packages/`、`apps/` 任何一行。
2. **机制**：纯追加——`shell.overlay` 注册移动端 chrome（底部导航、全屏会话抽屉）；`ctx.slots.inject` 等待槽声明；`ctx.layout` 做窄屏面板编排；移动断点为插件 `Config` 字段，用户层可覆盖。
3. **替换型槽位缓行**：v1 不替换 `sidebar` / `conversation` / `details` 占位者（替换会带走其声明的内部座位），确有必要时另起 ADR。
4. **抗漂移纪律**：只依赖声明了 JSDoc 契约的槽名与服务面；核心槽注册失败要响（加载即抛），锦上添花的功能用 `slots.inject` 静默降级；开发期以 npm release 的 `@deepseek-ai/*` 类型做 `SlotMap` 声明合并类型检查，上游改名即 typecheck 红。

## 后果

- **能做**：移动导航模式（底部导航 + 抽屉）、会话切换与新建入口、窄屏面板编排、插件自有组件的完整样式。
- **不能做（需上游源码，留作后续上游 PR 轨道）**：存量组件内部密度（输入栏、工具卡片、trajectory 表格的窄屏重排）、`ui-theme` 触控密度令牌、布局冻结常量调整、详情面板在 <996px 视口可达性（concession 链必关）。
- 被否决方案：
  - **上游 PR 优先**：预览期破坏性变更频繁，fork/补丁序列维护成本高；插件边界先把导航层价值落地，组件级适配后续仍可直接提上游 PR，两轨道不冲突。
  - **全局 CSS 覆盖插件**：违反样式所有权，类名哈希随上游构建漂移，脆弱。
  - **替换 `root` AppFrame**：塌掉全部子槽声明，所有插件 UI 一起消失，一票否决。
- 遗留风险：详情面板移动端不可达只能缓解不能根治；npm 类型包（0.0.1-rc.1）与源码运行时的契约漂移由运行时验证兜底。

## 取代关系

部分取代可行性文档第 3 节"移动 UI 适配建议作为上游 PR 推进"的优先级排序：导航层改由本插件先行，组件级响应式仍保留上游 PR 轨道。
