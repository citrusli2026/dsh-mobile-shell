# 09 Web 安全加固与端到端验证记录

状态：**已完成（2026-08-15）**。决策见 [ADR-0008](decisions/ADR-0008-device-session-and-web-hardening.md)。本阶段结论覆盖 Web；原生 App 只记录构建链健康度，不等同于真机发行验收。

## 1. 修复范围

| 部件 | 修复 |
|---|---|
| `proxy/dsh-remote.mjs` | 配对签发 30 天 HMAC 设备令牌；Web 只收 HttpOnly Cookie；新增 `/session` 降权入口；设备令牌禁止签发配对码；兼容查询登录先降权；严格 Host 与 origin-form 请求目标，畸形输入返回 400 且代理保持存活；已认证跨站 HTTP/WS 返回 403，同时兼容前置 TLS 终止；启动页响应加同源 CSP、Referrer Policy、nosniff、no-store；规范化 HMAC 签名比较、超大 JSON 返回 413、错误页消息 HTML 转义 |
| `app/www/index.html` | Web 不再存令牌；配对直接使用服务端 Cookie；手工令牌经 `/session` 换 Cookie；兼容交接使用 fragment；修复显式 HTTP/HTTPS 标准端口和自定义端口解析；启动时清除 fragment 和 legacy `?token=`；页面自身增加 CSP 与 no-referrer |
| `scripts/verify-proxy.mjs` | 扩充为 28 项真实上游矩阵，覆盖设备会话、降权、篡改、权限边界、同源检查、畸形 HTTP/WS、超大请求体与存活性 |
| `scripts/verify-launcher.mjs` | 直接执行实际内联脚本，回归地址解析、Web 存储、legacy 查询清理和 fragment 交接 |
| `proxy/e2e/` + `proxy/playwright.config.mjs` | 可复现的 Chromium/WebKit、移动 Chromium/WebKit 浏览器 E2E：二维码深链、用户确认、HttpOnly 会话、刷新保活、无效码不兑换、页面错误/网络失败收集 |
| `.github/workflows/verify-proxy.yml` | 启动页变更纳入触发路径；安装 Playwright 浏览器；在 HTTP 代理矩阵后运行四个浏览器/移动视口项目 |
| `app/package.json` | 修复 iOS 构建脚本指向不存在的 workspace；移除不存在的 verify 脚本；用 npm override 将开发链 `uuid` 提升到 11.1.1 |

## 2. 本机验证

以下命令均针对真实发布版 `dsh web` 上游，而非伪造服务：

```sh
node --check proxy/dsh-remote.mjs
node --check scripts/verify-proxy.mjs
node --check scripts/verify-launcher.mjs
node scripts/verify-launcher.mjs
node scripts/verify-pairing-qr.mjs

# 分别启动 HTTP 与自签 TLS 代理后
DSH_REMOTE_TOKEN=<test-token> node scripts/verify-proxy.mjs
PROXY_URL=https://127.0.0.1:<tls-port> DSH_VERIFY_INSECURE_TLS=1 \
  DSH_REMOTE_TOKEN=<test-token> node scripts/verify-proxy.mjs

# 真实 dsh web + dsh-remote 已启动后
npm ci --prefix proxy
npx --prefix proxy playwright install chromium webkit
DSH_REMOTE_TOKEN=<test-token> E2E_BASE_URL=http://127.0.0.1:3081 \
  npm run test:e2e --prefix proxy
# 使用本机安装的 Google Chrome 额外复跑桌面项目
E2E_USE_INSTALLED_CHROME=1 DSH_REMOTE_TOKEN=<test-token> \
  npm run test:e2e:chrome --prefix proxy

# 原生构建门禁
npm ci --prefix app
npm run sync --prefix app
npm run build:ios --prefix app
npm run build:android --prefix app  # 需要本机 Android SDK
```

| 验证层 | 结果 |
|---|---|
| Node 语法检查 | ✅ 代理与两份验证脚本全部通过 |
| 启动页脚本回归 | ✅ 地址解析、Web 不存令牌、fragment 交接、legacy 查询清理全部通过 |
| 真实 dsh HTTP 矩阵 | ✅ 28/28 |
| 真实 dsh HTTPS/WSS 矩阵 | ✅ 28/28 |
| 浏览器 E2E | ✅ 8/8：Chromium、WebKit（Safari 引擎）、移动 Chromium、移动 WebKit；扫码深链 → 一次确认 → Harness → 刷新保活；另用本机 Google Chrome 2/2 通过。测试仍收集未知页面/控制台/网络错误；只对 dsh UI 首次加载偶发的 Cordis inventory / `credentials.describe` warm-up 诊断做显式标注 |
| 依赖安全审计 | ✅ `npm audit --prefix app`、`npm audit --prefix proxy` 无中危及以上漏洞 |
| iOS 模拟器构建 | ✅ `npm run build:ios --prefix app`，Xcode 26.6 / iOS Simulator SDK 26.5 |
| Android Debug 构建 | ⚠️ 本机未安装 Android SDK，Gradle 在 SDK 定位阶段停止；CI workflow 仍提供 JDK 21 + SDK 36 构建环境 |
| `DSH_LAUNCHER=off` | ✅ `/` 返回 401，`/launch` 返回 404 |

## 3. 当前边界

- 设备令牌 30 天自动过期，当前无单设备吊销；旋转 `DSH_REMOTE_TOKEN` 会吊销全部设备。
- 明文 HTTP 只适合可信局域网；公网必须由 dsh-remote 或前置反向代理提供可信 HTTPS。
- WebKit 是 Safari 浏览器引擎级验证，不等同于实体 iPhone/iPad Safari；移动端 App、实体设备 Safari、真实网络断线/后台和发布签名仍留到下一阶段，不能由本阶段结果推定为已通过。
- Android 构建不是代码失败，而是当前工作机缺少 `ANDROID_HOME`/`ANDROID_SDK_ROOT` 和 SDK；在 CI 或安装 SDK 后重新执行上面的命令即可复核。
