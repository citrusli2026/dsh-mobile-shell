# 04 阶段 1 PoC：构建、运行与局域网验证记录

状态：**已完成（2026-08-14）**。双端产物产出，局域网链路验证通过。

## 1. 组成

| 部件 | 位置 | 说明 |
|---|---|---|
| App 壳 | `mobile/app/` | Capacitor 8.5.0，启动页配对（地址+令牌、记忆、预检），进入主机伺服的原版 Web UI |
| 令牌反代 | `mobile/proxy/dsh-remote.mjs` | 零依赖 Node ≥20；dsh web 保持 loopback，代理监听 3081 做令牌门（ADR-0004） |
| iOS 离线依赖 | `mobile/app/ios/vendor/capacitor-swift-pm/` | 官方 8.5.0 xcframework，sha256 核验，本地 binaryTarget（ADR-0005） |
| 验证脚本 | `mobile/scripts/cdp-android-e2e.py` | 经 CDP 驱动 Android WebView 自动完成配对并断言落点 |

## 2. 运行（从仓库根）

```sh
# 主机（保持默认 loopback）
node apps/cli/lib/bin.js web --port 3080        # 或 pnpm dsh web

# 代理（令牌自定，至少 8 位）
DSH_REMOTE_TOKEN=<token> node mobile/proxy/dsh-remote.mjs

# Android 构建（JDK 需 17–21；本机全局 Gradle 钉了 JDK25，需命令行覆盖）
cd mobile/app && npm install                   # 慢则配 registry.npmmirror.com
cd android && ./gradlew assembleDebug \
  -Dorg.gradle.java.home=$HOME/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home
# 产物：mobile/app/android/app/build/outputs/apk/debug/app-debug.apk

# iOS 构建（全离线；DEVELOPER_DIR 指向 Xcode）
cd mobile/app && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/build build
```

App 启动页填 `http://<主机局域网IP>:3081` + 令牌即可连接。真机安装：Android 直接装 APK；iOS 需开发者签名（PoC 用模拟器，真机/TestFlight 属阶段 3）。

## 3. 验证矩阵（证据：`mobile/.run/` 截图与日志，随验证时环境）

| # | 用例 | 结果 |
|---|---|---|
| 1 | `GET /healthz` 无令牌 | 200 + `Access-Control-Allow-Origin: *` |
| 2 | `GET /` 无令牌 / 错令牌 | 401 / 401 |
| 3 | `GET /?token=正确` | 302 + `Set-Cookie: dsh_token=…; HttpOnly; SameSite=Lax` |
| 4 | 携 Cookie 取 `/` | 200，返回 `<title>DeepSeek Harness</title>` |
| 5 | `POST /api/...` 无 Cookie | 401 |
| 6 | 经局域网 IP（192.168.1.26）携 Cookie | 200（非 loopback 路径） |
| 7 | WS 握手无令牌 / 携 Cookie | 403 / **101**，`session/subscribed` 真实事件流经隧道 |
| 8 | 认证 `/api` POST（伪造 LAN Origin） | 404 而非 403——Host/Origin 改写使上游围栏按 loopback 通过 |
| 9 | Android 模拟器：APK 安装→启动页渲染 | 截图 `android-launcher.png` |
| 10 | Android 模拟器：CDP 自动配对→落到 `http://192.168.1.26:3081/`，标题 `DeepSeek Harness`，工作区选择器可见 | 截图 `android-dsh-ui.png` |
| 11 | iOS 模拟器：BUILD SUCCEEDED→安装→启动页渲染（iPhone 17 Pro, iOS 26.5） | 截图 `ios-launcher.png` |
| 12 | iOS 模拟器 Safari（同 WebKit）：`?token=` 全流程→dsh UI 展示 | 截图 `ios-safari-dsh.png` |

## 4. 过程中发现并解决的问题（本阶段实际踩坑记录）

1. **Gradle 守护进程被全局配置钉在 JDK 25**（`~/.gradle/gradle.properties` 的 `org.gradle.java.home`），Gradle 8.14.3 的 Groovy 无法解析（class file 69）。不改用户全局配置，命令行 `-Dorg.gradle.java.home=<JDK21>` 覆盖。
2. **Android 启动页 fetch 报 "Failed to fetch"**：Capacitor 8 默认 `androidScheme: https`，https 源页面抓 http 接口被混合内容拦截。改为 `androidScheme: 'http'`。
3. **跨源导航被交给系统浏览器**：Capacitor Android 默认把非本机源导航抛给 Chrome。`server.allowNavigation: ['*']` 放行（信任边界在代理令牌门）。
4. **iOS SPM 远程解析无限挂起**：官方包是 binaryTarget 包，xcframework zip 走 github.com Releases；xcodebuild 侧不可复现地停在 `waitForRemoteSourcePackagesToFinishLoading`。本地化 vendor + 校验和后构建全离线通过（ADR-0005）。注意：**并行重复的 xcodebuild 会在同一 DerivedData 上互锁**，复现阶段曾因此长时间"假死"。
5. **代理 WS 握手 426**：转发时误删 `Connection: Upgrade` 头；WS 路径单独保留握手头（见提交 `eedcc011`）。

## 5. 已知限制（PoC 边界）

- 明文 HTTP：仅限可信局域网/组网（Tailscale 等）；公网暴露前必须完成阶段 2（代理终结 TLS + 收窄双端明文开关）。
- 模型对话需主机配置 `DEEPSEEK_API_KEY`（本验证环境无 key，未覆盖真实模型回合）。
- 界面是桌面布局：手机上可读可用（截图可见），窄屏导航/面板编排由并行推进的 `dsh-mobile-ui` 插件（ADR-0003）负责。
- iOS 未做真机签名分发；应用内 WKWebView 导航未在模拟器上脚本化驱动（WKWebView 无 CDP），其导航行为由 Capacitor iOS 主框架默认允许跨源导航的事实 + 与 Android 相同的启动页代码路径背书，真机确认列为阶段 3 验收项。
- 上游 UI 版本即主机版本（`server.url` 模式思想由启动页跳转实现），升级主机即升级 UI，壳无需发版。

## 6. 下一步（阶段 2 候选）

1. 代理终结 TLS（自签/局域网 CA）+ 短期二维码令牌换长期设备令牌的配对流。
2. GitHub 仓库与 Actions CI（Android APK、iOS simulator build 双流水线）+ Releases 分发（含国内镜像）。
3. 向上游提交可选 token 认证 PR（代理可退化为纯 TLS 终结）。
