# dsh-mobile-shell

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的社区开源**移动壳**：一个轻薄的 WebView 应用，把你的手机连接到你自己托管的 `dsh web` 主机；配套一个令牌反代，把主机安全地暴露到局域网。

> **非 DeepSeek 官方产品。** 这是基于 MIT 许可上游构建的社区配套客户端。harness 本体从不在手机上运行：所有工具执行（shell、文件、终端、LSP……）都留在你的主机上，因此移动版**天然与桌面 Web 版功能一致**。

## 仓库内容

| 路径 | 说明 |
|---|---|
| [`app/`](app/) | Capacitor 8 双端壳：配对启动页（主机地址 + 令牌，可记忆），随后 WebView 直接加载主机伺服的原版前端——App 与主机版本永不脱节 |
| [`proxy/`](proxy/) | `dsh-remote`：零依赖 Node ≥20 反代。`dsh web` 保持 loopback（上游刻意禁止绑 `0.0.0.0`），代理负责网络可达、逐请求（含 WebSocket 握手）的常量时间令牌门，并直接伺服启动页（Web 模式，ADR-0007） |
| [`scripts/`](scripts/) | 验证工具（CDP 驱动的 Android 端到端、代理冒烟矩阵） |
| [`docs/`](docs/) | 架构分析、可行性研究、PoC 实录，以及全部关键决策的 ADR |

配套插件：[`dsh-mobile-ui`](https://github.com/citrusli2026/dsh-mobile-ui)——以树外客户端插件形式为主机 Web UI 提供移动导航（底部导航栏、会话抽屉）。壳不依赖它，它也不依赖壳。

## 快速开始

**1. 在电脑上**——启动主机与代理：

```sh
npx @deepseek-ai/dsh web --port 3080          # harness 照常跑在 loopback
DSH_REMOTE_TOKEN=$(openssl rand -hex 16) node proxy/dsh-remote.mjs
# dsh-remote: http://0.0.0.0:3081 -> http://127.0.0.1:3080 (token required)
# dsh-remote: pairing code 847291 — single use, expires in 10 min
```

**2. 在手机上**（同一 Wi-Fi）——两种方式任选：

- **Web 模式（零安装，ADR-0007）**：浏览器直接打开 `http://<电脑局域网IP>:3081/`——代理会自己吐出启动页。输入终端打印的**配对码**即可进入，主令牌全程不离开电脑。
- **App**：安装壳，填 `http://<电脑局域网IP>:3081` 与配对码（"令牌连接"保留为高级入口）。记忆主机后一键重连。
  - **Android**：从 [Releases](../../releases) 直接下载 APK 安装。
  - **iOS**：从源码构建（见下）或等待 TestFlight——苹果没有免签名的直接安装路径。

## 从源码构建

```sh
git clone https://github.com/citrusli2026/dsh-mobile-shell.git
cd dsh-mobile-shell/app && npm install

# Android（JDK 17–21；Gradle 下载已配好国内镜像，见文档）
cd android && ./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk

# iOS（需要 Xcode；完全离线——Capacitor 的 SPM 二进制已 vendor 并通过
# sha256 核验，见 docs/decisions/ADR-0005）
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/build build
```

下载慢？npm / Gradle / Maven / Node 头文件的国内镜像配置汇总在 [docs/02-build-and-dependencies.md](docs/02-build-and-dependencies.md) 第 4 节。

## 安全模型——暴露之前必读

- 令牌是唯一认证手段；代理对每个请求和每次 WS 握手强制校验，未配置 `DSH_REMOTE_TOKEN` 时拒绝启动。未授权访客只能看到启动页（Web 模式）——`/api`、WebSocket 与真正的 UI 全部有门；想恢复纯 401 面孔可设 `DSH_LAUNCHER=off`。
- **默认明文 HTTP**：仅限可信局域网或 Tailscale 等组网内使用。公网暴露请启用 TLS，但**证书由你提供**（`DSH_TLS_CERT`/`DSH_TLS_KEY`——真实 CA 签发的域名证书；自签证书在原生 WebView 里不可用，见 ADR-0006）。
- Android/iOS 工程因此放开了明文开关；TLS 落地时必须同步收回（ADR-0004）。

## 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | PoC：壳 + 令牌代理，双端模拟器局域网验证 | ✅ 已完成（[实录](docs/05-phase1-poc.md)） |
| 2 | 配对码、代理可选 TLS | ✅ 已完成（[实录](docs/06-phase2-pairing-tls.md)） |
| 3 | 移动 UI 打磨（`dsh-mobile-ui`）、内置资产离线壳、TestFlight / 商店 | 进行中——[真机验证清单](docs/07-real-device-verification.md) |

## 文档

- [docs/README.md](docs/README.md)——总索引：项目分析、构建与依赖指南、可行性研究、PoC 实录
- [docs/decisions/](docs/decisions/)——ADR-0001…0007，每个关键决策一份

## 许可证

[MIT](LICENSE)。vendored 组件（如 `app/ios/vendor/` 下的 Capacitor iOS 二进制）保留各自许可证。DeepSeek Harness 本体由 DeepSeek AI 以 MIT 许可发布。
