# DeepSeek Harness 移动版（dsh-mobile）

把 DeepSeek Harness（`dsh`）打包成可直接下载使用的移动应用，功能与桌面 Web 版保持一致，并以开源形式发布（目标：独立 GitHub 开源仓库）。

## 目标

- 用户从 GitHub Releases / 应用商店下载安装即可使用，不需要自行构建。
- 功能不裁剪：会话、工具执行、审批、文件与终端等能力与 `dsh web` 一致。
- 全部代码开源，构建过程可复现。

## 关键约束（来自需求方）

1. **过程留痕**：每一步单独提交；除功能实现外，用决策记录（ADR）文档记录探索与决策过程，文档集中放在 `docs/` 目录（本目录下的 `docs/`）。
2. **下载加速**：任何下载过慢的场景，优先切换为国内镜像源（npm 二进制、Node 头文件、Playwright、pip 等，见 `docs/02-build-and-dependencies.md`）。
3. **独立实施**：`~/dsh-desktop` 是并行的另一套实现，本项目不参考、不依赖它，独立完成。

## 当前状态

两条线并行推进，均已落地验证：

- **壳与连接（本线）**：阶段 1 PoC 完成——Capacitor 双端壳 [`app/`](app/) + 令牌反代 [`proxy/`](proxy/)，Android APK 与 iOS 模拟器包产出，局域网令牌连接在双端模拟器验证通过（[实录](docs/05-phase1-poc.md)）。
- **移动 UI（并行线）**：插件 [`dsh-mobile-ui`](plugins/dsh-mobile-ui/)（树外客户端插件，操作条 + 会话抽屉）已实现并通过端到端验证（[实录](docs/04-mobile-ui-plugin.md)）。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/README.md](docs/README.md) | 文档索引与工作约定 |
| [docs/01-project-analysis.md](docs/01-project-analysis.md) | 上游项目架构分析 |
| [docs/02-build-and-dependencies.md](docs/02-build-and-dependencies.md) | 构建与依赖下载流程分析（含国内镜像方案） |
| [docs/03-feasibility-analysis.md](docs/03-feasibility-analysis.md) | 移动版可行性分析与推荐路线 |
| [docs/04-mobile-ui-plugin.md](docs/04-mobile-ui-plugin.md) | 移动 UI 插件实施与验证 |
| [docs/05-phase1-poc.md](docs/05-phase1-poc.md) | 阶段 1 PoC：双端壳 + 令牌代理 + 局域网验证 |
| [docs/decisions/](docs/decisions/) | 决策记录（ADR） |

## 代码

| 目录 | 内容 |
|---|---|
| [app/](app/) | Capacitor 8 双端壳工程（启动页配对，Android APK / iOS 工程） |
| [proxy/](proxy/) | dsh-remote 令牌反代（dsh web 保持 loopback 的局域网暴露方案） |
| [scripts/](scripts/) | 验证脚本（CDP 驱动 Android WebView 的端到端用例） |
| [plugins/dsh-mobile-ui/](plugins/dsh-mobile-ui/) | 移动 UI 覆盖层插件（树外 `dsh.client` 双面包，可 `dsh plugin add` 安装） |
