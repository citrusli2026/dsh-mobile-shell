# dsh-mobile-shell

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的社区开源**移动壳**：一个轻薄的 WebView 应用，把你的手机连接到你自己托管的 `dsh web` 主机；配套一个令牌反代，把主机安全地暴露到局域网。

> **非 DeepSeek 官方产品。** 这是基于 MIT 许可上游构建的社区配套客户端。harness 本体从不在手机上运行：所有工具执行（shell、文件、终端、LSP……）都留在你的主机上，因此移动版**天然与桌面 Web 版功能一致**。

## 仓库内容

| 路径 | 说明 |
|---|---|
| [`app/`](app/) | Capacitor 8 双端壳：配对启动页（主机地址 + 设备会话，可记忆），随后 WebView 直接加载主机伺服的原版前端——App 与主机版本永不脱节 |
| [`proxy/`](proxy/) | `dsh-remote`：零依赖 Node ≥20 反代。`dsh web` 保持 loopback（上游刻意禁止绑 `0.0.0.0`），代理负责网络可达、逐请求（含 WebSocket 握手）的常量时间令牌门，并直接伺服启动页（Web 模式，ADR-0007） |
| [`scripts/`](scripts/) | 一键安全局域网启动与验证工具（启动页回归、真实 dsh HTTP/HTTPS/WSS 代理矩阵、CDP 驱动的 Android 端到端） |
| [`docs/`](docs/) | 架构分析、可行性研究、PoC 实录，以及全部关键决策的 ADR |

移动 UI 插件 `dsh-mobile-ui` 曾以树外客户端插件形式为主机 Web UI 提供移动导航（底部导航栏、会话抽屉），但原公开仓库当前无法访问，已放入 [移动端后移 backlog](docs/10-roadmap-to-release.md#8-androidios-后移-backlog)。在恢复并固定版本前不要按旧链接安装；基础壳和 Web 模式不依赖该插件。

## Web 产物：给桌面端或外部主机使用

Web 集成与 Capacitor 工程隔离。根目录脚本只打包运行所需的 Node 代理、启动页和二维码模块，不包含 `app/android`、`app/ios`、原生依赖或开发工具：

```sh
cd dsh-mobile-shell
npm run package:web
# 产物：dist/web/
npm run verify:web
```

`dist/web/web-artifact.json` 是稳定的集成契约，声明 `proxy`、`launcher` 和 `pairing` 三个入口以及格式版本。桌面端只读取这个 manifest；因此本仓库内部可以继续调整源码目录，桌面端不需要跟着改路径。发布时可直接分发目录，或打成压缩包：

```sh
tar -czf dist/dsh-mobile-shell-v1.0.0-web.tar.gz -C dist/web .
```

外部主机只需自行启动 loopback 上的 `dsh web`，再启动产物中的代理；两者是独立进程：

```sh
npx @deepseek-ai/dsh web --port 3080
DSH_REMOTE_TOKEN="$(openssl rand -hex 16)" \
DSH_TARGET_PORT=3080 \
node dist/web/start.mjs
```

默认代理监听 `0.0.0.0:3081`，会提供 Web 启动页、一次性配对码和二维码所需的配对 URL。可用 `DSH_LISTEN_HOST`、`DSH_LISTEN_PORT`、`DSH_TARGET_HOST`、`DSH_TARGET_PORT` 覆盖地址；公网使用时还应同时配置 `DSH_TLS_CERT`、`DSH_TLS_KEY` 和可信的 `DSH_PUBLIC_URL`。明文 HTTP 只适用于可信局域网或组网网络，不要做端口转发。

桌面端集成示例：先在本仓库生成 `dist/web`，再在 `dsh-desktop` 中执行 `DSH_MOBILE_SHELL_WEB_ROOT=/绝对路径/dsh-mobile-shell/dist/web pnpm run build`。Electron 安装包只携带这一份 Web 产物，Android/iOS 工程仍属于本仓库的独立发布面。

## 版本号

当前项目版本为 `1.0.0`，唯一来源是根目录 `package.json`。代理包、Capacitor 包、Android 的 `versionName`、iOS 的 `MARKETING_VERSION` 和 Web 产物 manifest 都会与它校验一致：

```sh
npm run verify:version
npm run package:web
```

发布标签统一使用 `v<版本号>` 格式；发布前可用 `node scripts/verify-version.mjs v1.0.0` 显式校验。推送匹配标签后会自动构建并发布 Android、iOS 和 Web 三类产物。已有历史标签不回写。

## 快速开始：启动 / 扫码 / 确认

推荐只执行这一条命令；它会自动启动 loopback 上的 `dsh web` 和局域网代理，选择一个私有局域网 IPv4，生成本次运行专用的随机主令牌，并打印离线二维码：

```sh
node scripts/start-lan.mjs
```

然后只需三个步骤：

1. **启动**：在电脑上运行上面的命令，并保持终端运行。
2. **扫码**：手机与电脑连接同一 Wi-Fi，扫描终端二维码。
3. **确认**：手机浏览器点击一次“确认配对并连接”，直接进入 Harness。

扫码场景不需要输入 IP、配对码或令牌。脚本拒绝公网 IP、`0.0.0.0` 和继承的公网/TLS 配置；如果电脑有多个局域网地址，可显式指定：`DSH_LAN_IP=192.168.1.23 node scripts/start-lan.mjs`。明文 HTTP 仍只适用于可信局域网，不要做路由器端口转发。

高级模式才需要分别启动主机与代理：

```sh
npx @deepseek-ai/dsh web --port 3080
DSH_REMOTE_TOKEN=$(openssl rand -hex 16) node proxy/dsh-remote.mjs
```

**手机**（同一 Wi-Fi）——也可以使用 App：

- **Web 模式（零安装，ADR-0007）**：扫描终端二维码后，浏览器会打开启动页、清理扫码 fragment 并预填配对码；确认一次即可进入。主令牌全程不离开电脑。
- **App**：安装壳，填 `http://<电脑局域网IP>:3081` 与配对码（"令牌连接"保留为高级入口）。记忆主机后一键重连。
  - **Android**：从 [Releases](https://github.com/citrusli2026/dsh-mobile-shell/releases) 直接下载 APK 安装。
  - **iOS**：从源码构建（见下）或等待 TestFlight——苹果没有免签名的直接安装路径。

> **Web 验证状态（2026-08-15）：已通过。** 已对真实发布版 `dsh web` 完成 HTTP 28/28、HTTPS/WSS 28/28 自动化矩阵；Playwright Chromium/WebKit 及移动 Chromium/WebKit 均完成“打开二维码深链 → 明确确认 → 进入 DeepSeek Harness → 刷新后保持会话”，本机安装的 Google Chrome 额外通过 2/2。完整记录见 [Web 安全加固与验证实录](docs/09-web-security-hardening.md)。本结论不包含实体 Safari 与尚待下一阶段验证的移动端 App。

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

- 代理对每个请求和每次 WS 握手强制校验；未配置主令牌 `DSH_REMOTE_TOKEN` 时拒绝启动。配对码签发 30 天有效的签名设备会话：浏览器只得到 HttpOnly Cookie，主令牌不会进入响应正文、URL 或浏览器存储；设备会话不能继续签发配对码。未授权访客只能看到启动页，跨源的已认证 API/WS 请求也会拒绝。
- **默认明文 HTTP**：仅限可信局域网或 Tailscale 等组网内使用。公网暴露请启用 TLS，但**证书由你提供**（`DSH_TLS_CERT`/`DSH_TLS_KEY`——真实 CA 签发的域名证书；自签证书在原生 WebView 里不可用，见 ADR-0006）。
- Android/iOS 工程因此放开了明文开关；TLS 落地时必须同步收回（ADR-0004）。

## 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | PoC：壳 + 令牌代理，双端模拟器局域网验证 | ✅ 已完成（[实录](docs/05-phase1-poc.md)） |
| 2 | 配对码、代理可选 TLS | ✅ 已完成（[实录](docs/06-phase2-pairing-tls.md)） |
| Web | 浏览器零安装、设备会话与安全加固 | ✅ 已完成并通过端到端验证（[实录](docs/09-web-security-hardening.md)） |
| 3 | Web 二维码、完整设备生命周期、管理/部署体验与国际化 | Web-first 进行中——[路线图](docs/10-roadmap-to-release.md) |
| 4 | Android/iOS 构建、签名、移动 UI 与真机发行门禁 | 后移——[真机清单](docs/07-real-device-verification.md) |
| 5 | 推送、完整离线壳等高成本体验功能 | Web 稳定后评估 |

## 文档

- [docs/README.md](docs/README.md)——总索引：项目分析、构建与依赖指南、可行性研究、PoC 实录
- [Web 二维码配对实录](docs/11-web-qr-pairing.md)——离线二维码、扫码深链与验证结果
- [docs/decisions/](docs/decisions/)——ADR-0001…0009，每个关键决策一份

## 许可证

[MIT](LICENSE)。vendored 组件（如 `app/ios/vendor/` 下的 Capacitor iOS 二进制）保留各自许可证。DeepSeek Harness 本体由 DeepSeek AI 以 MIT 许可发布。
