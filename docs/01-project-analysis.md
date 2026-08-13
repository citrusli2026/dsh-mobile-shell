# 01 上游项目架构分析

分析对象：本仓库（deepseek-harness，`dsh`），版本 `0.1.0-rc.5`，MIT 许可证，开发者预览阶段（上游 README 明确声明会有破坏性变更）。本文结论服务于移动版可行性判断；所有论断标注了可复核的上游文件路径。

## 1. 产品形态

`dsh` 是一个 AI 智能体运行时（agent harness）："一切皆插件"，构建在 vendored 的 Cordis 4 框架之上（根 `AGENTS.md`、`docs/architecture.md`）。模型适配器、工具注册表、会话日志、智能体循环本身都是插件，可从配置层整体替换。

对外的产品入口（`apps/cli/package.json`，bin 为 `dsh`）：

- `dsh web`：启动本机 HTTP 服务（默认 `http://127.0.0.1:3080`），浏览器打开 Web UI（根 `README.md`）。
- `dsh --profile headless`：无服务器的一次性任务运行器（根 `AGENTS.md`）。
- ACP 自动化服务器、JSON-RPC SDK（`packages/acp`、`packages/sdk`）、Python SDK（`python/`）属于嵌入式用法，与移动版关系不大。

## 2. 插件组合方式

- 运行时是一棵插件树，由 **profile** 组合而成；`web` 与 `headless` 是官方模板（`docs/architecture.md` "Profiles and bundles"）。
- **bundle** 是配置行 + 代码的分发格式：`dsh-base`（模型适配器、工具、持久化、沙箱、审批、设置、凭据、遥测）是所有 profile 的第一层；`dsh-web-app` 叠加浏览器应用；`dsh-headless` 叠加一次性运行器。
- 用户的 `cordis.patch.yml` 与 `--patch` 覆盖层逐行替换配置。`dsh --profile web --dump-config` 可打印实际启动树。

意义：移动版若要增删能力（例如加认证层），优先做法是新增一个 bundle/补丁层，而不是改上游代码。

## 3. 客户端 / 服务端边界（移动版最关键的事实）

代码库已有清晰的 client / host 分层：

| 层 | 位置 | 职责 |
|---|---|---|
| 浏览器客户端 | `apps/web`（Vite + React 18，构建产物 `dist/`）+ `packages/client/*`（约 40 个 `ui-*` 界面包、`connection`、`runtime`） | 纯 UI 与 RPC 调用，不执行任何本地能力 |
| 主机端 | `apps/cli`（`dsh web`）+ `packages/host/*`（`webserver`、`apiproxy`、`frontend-static` 等） | 插件树、会话、全部工具执行 |
| RPC 层 | `packages/api/gateway`（Typert unary RPC）+ `packages/api/remotes`（BFF 策略），未迁移方法走遗留 `host/apiproxy` | 类型化 RPC 端点 |

传输协议（`packages/client/connection/src/`）：

- 上行：HTTP POST 到 `/api/<channel>/<endpoint>`（`http-bridge.ts`、`client/rpc.ts`），流式响应用 SSE。
- 下行：两条 WebSocket 事件流 `/api/events.mux` 与 `/api/events.host`（`websocket-downlink.ts`）；WS 上客户端发消息属协议违规，上行永远走 HTTP。
- 浏览器端 API 基地址取自 `location.origin`，唯一可覆盖点是 `client/rpc.ts` 的 `resolveBase()`（同源部署的假设集中在这一个函数）。

能力执行位置：文件系统、Bash/子进程、持久终端、LSP、MCP、E2B 云沙箱等全部在主机侧经 capability seam（Service Definition / Provider / Consumer 三角色，`docs/architecture.md`）执行。模型推理走远端 DeepSeek API（HTTPS），本地不跑模型。

**结论：浏览器已经是一个纯瘦客户端。移动 App 复用这套 Web 前端 + 指向远端 host，即可在不动执行语义的前提下获得全部功能。**

## 4. 安全现状（决定移动版的必修项）

- Web 服务器只支持两种绑定：`'127.0.0.1' | '0.0.0.0'`（`packages/host/webserver/src/index.ts` 的 `Config`），端口可配。
- **没有认证层**。`/api` 前只有一道 Host 头信任围栏，防 DNS 重绑定与跨站请求；源码注释原话："Network reachability and authentication stay out of scope … this fence is not an auth layer"（`packages/client/connection/src/api-request-trust.ts`）。围栏放行 loopback 与声明过的 `trustedHosts`（LAN IP 字面量）。
- 也就是说：任何能连到端口的人都能驱动智能体在主机上执行 shell 命令。把 `dsh web` 暴露到局域网/公网前，必须自己解决认证与加密（反代 + token、Tailscale/WireGuard、SSH 隧道），或向上游贡献认证能力。

## 5. 前端对移动形态的现状

- 已有 PWA 雏形：`apps/web/index.html` 声明了 `manifest.webmanifest`（`display: fullscreen`）与 viewport meta；但**没有 service worker**，不能离线，也达不到商店级安装体验。
- 界面面向桌面：`packages/client/ui-*` 中未见移动断点（仅 `prefers-reduced-motion`）。移动版需要补响应式布局或做移动专属信息架构。

## 6. 与移动版无关或暂不涉及的部分

- `native/landlock-run`：Linux Landlock 沙箱启动器（npm 平台包分发），桌面/服务器沙箱能力。
- `python/`：Python SDK 与打包的单可执行运行时。
- `packages/e2b`：E2B 云沙箱 POC。
- `website/`：VitePress 文档站。

## 7. 对移动版的事实清单（后续文档引用）

1. C/S 分离现成，协议 = HTTP RPC + SSE + 两条 WS 下行流。
2. 客户端基地址单点可改（`resolveBase()`）。
3. 主机端能力执行与 UI 完全解耦 → 功能可 100% 保留在主机侧。
4. 模型调用本来就是远端 HTTPS。
5. 无认证、无 TLS，绑定策略仅有 loopback/0.0.0.0 → 移动远程访问的最大缺口。
6. 有 PWA manifest 无 service worker；UI 无移动适配。
7. 插件化配置允许以 bundle/patch 形式叠加移动所需改动，无需 fork 上游核心。
