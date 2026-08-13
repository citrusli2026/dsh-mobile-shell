# dsh-mobile-ui

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI 的移动端 UI 覆盖层，以**树外客户端插件**形式交付——不改上游任何源码。它为小屏视口补上桌面三栏壳没有的导航模式。

## 功能

- **输入框上方的操作条**（会话作用域）:`会话`按钮打开会话抽屉（带徽标，统计正等待审批/提问的会话数），`新会话`按钮直达新会话。仅在移动模式渲染，桌面端界面完全不受影响。
- **全屏会话抽屉**（框架浮层）:按主机顺序列出存活会话（空白占位会话除非是当前会话否则隐藏），行内状态点（待处理 / 运行中 / 已完成），当前会话高亮，顶部有新会话行。选择、点遮罩、点关闭按钮均可关闭。
- **移动模式检测**:`matchMedia` 宽度断点 + 粗指针事实，以响应式数据源注入组件。断点是插件 `Config` 字段（默认 `768`，单位 px)。

全部为追加式实现：不替换任何槽位占位者，不写全局 CSS（组件样式消费主题的 `--dsw-alias-*` 语义令牌），两个槽位都经 `ctx.slots.inject` 等待声明——上游若不再声明这些槽位，插件静默降级为空操作，不会让启动失败。

## 安装

需要 `dsh` CLI（已安装或源码检出）。安装到内置 `web` profile:

```sh
dsh plugin --profile web add dsh-mobile-ui      # npm / tarball / git 均可
# 或从本地检出安装：
dsh plugin --profile web add ./dsh-mobile-ui
dsh --profile web
```

安装后 profile 的 bundle 列表为 `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-mobile-ui"]`；视口宽度不超过断点时出现移动端界面。卸载：`dsh plugin --profile web remove dsh-mobile-ui`。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖该行的 `config`（后层生效；需完整重述 config):

```yaml
- id: ui-mobile
  config:
    breakpoint: 820   # 单位 px；最小 320
```

## 开发

```sh
npm install                # 构建/测试工具（tsdown、vitest 等）
npm run link:upstream      # 链接 deepseek-harness 检出的类型（argv[1] = 仓库根）
npm run typecheck          # 针对检出源码面的严格 tsc
npm run build              # 产出 lib/index.js（node 半）+ lib/client.js（浏览器 bundle）
npx vitest run             # 组件行为测试
```

注意：

- **`link:upstream` 仅类型检查需要。** 多个 `@deepseek-ai/*` npm 包目前无法安装（依赖了未发布的名字，如 `dsh-compact`)，因此契约类型经符号链接来自仓库检出。npm install 会清掉这些符号链接——任何安装之后都要重跑 `link:upstream`。构建与安装不需要这些链接。
- 浏览器 bundle 是 harness 模块表的闭包工厂：外链为平台模块（`react`、`@deepseek-ai/cordis`、`dsh-client-ui-slots` 等）加 `dsh-client-runtime/client`，其余全部内联。`tsdown.config.ts` 里的纯度门禁会拒绝跨插件值导入。
- 消费的两个 SlotMap 条目（`shell.overlay`、`conversation.input.dock`）在 `src/client/contract.ts` 以结构镜像声明并标注上游出处；升级上游时应对照检查。

## Model Experience

无。插件只渲染客户端对象层已有状态（会话列表、选中项、待处理标记）并发起导航动作；它展示与发送的任何内容都不会进入模型请求，因此不新增会话事件、不增加提示词 token。

#### KV Cache effect

无；本包不组装也不发送任何 provider 请求。

## 已知限制

- **详情面板在手机上仍不可达**——布局 concession 链在约 996px 以下强制关闭它，该几何是 `ui-layout` 的契约冻结值（属上游源码）。工具详情仍可在聊天行内查看。
- **无会话的 Hero 页没有操作条**——操作条座位是会话作用域；无当前会话时请先用桌面轨道或先进入任意会话。
- **存量组件内部密度不在范围内**——重画现有组件（输入栏、工具卡片、trajectory 表格）属于各包自己的 CSS Modules 与主题令牌，树外插件不能也不应触碰。此类细化请关注上游演进。
- **类型检查需要仓库检出**，直到上游类型包能从 npm 干净安装为止。
