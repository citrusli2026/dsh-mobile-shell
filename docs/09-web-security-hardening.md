# 09 Web 安全加固与端到端验证记录

状态：**已完成（2026-08-15）**。决策见 [ADR-0008](decisions/ADR-0008-device-session-and-web-hardening.md)。本阶段只处理并验证 Web；Android/iOS 未纳入本轮结论。

## 1. 修复范围

| 部件 | 修复 |
|---|---|
| `proxy/dsh-remote.mjs` | 配对签发 30 天 HMAC 设备令牌；Web 只收 HttpOnly Cookie；新增 `/session` 降权入口；设备令牌禁止签发配对码；兼容查询登录先降权；严格 Host 与 origin-form 请求目标，畸形输入返回 400 且代理保持存活；已认证跨站 HTTP/WS 返回 403，同时兼容前置 TLS 终止；启动页响应加同源 CSP、Referrer Policy、nosniff、no-store |
| `app/www/index.html` | Web 不再存令牌；配对直接使用服务端 Cookie；手工令牌经 `/session` 换 Cookie；兼容交接使用 fragment；修复显式 HTTP/HTTPS 标准端口和自定义端口解析；页面自身增加 CSP 与 no-referrer |
| `scripts/verify-proxy.mjs` | 扩充为 27 项真实上游矩阵，覆盖设备会话、降权、篡改、权限边界、同源检查、畸形 HTTP/WS 与存活性 |
| `scripts/verify-launcher.mjs` | 直接执行实际内联脚本，回归地址解析、Web 存储和 fragment 交接 |
| `.github/workflows/verify-proxy.yml` | 启动页变更纳入触发路径；在 HTTP/TLS 代理矩阵前执行启动页回归 |

## 2. 本机验证

以下命令均针对真实发布版 `dsh web` 上游，而非伪造服务：

```sh
node --check proxy/dsh-remote.mjs
node --check scripts/verify-proxy.mjs
node --check scripts/verify-launcher.mjs
node scripts/verify-launcher.mjs

# 分别启动 HTTP 与自签 TLS 代理后
DSH_REMOTE_TOKEN=<test-token> node scripts/verify-proxy.mjs
PROXY_URL=https://127.0.0.1:<tls-port> DSH_VERIFY_INSECURE_TLS=1 \
  DSH_REMOTE_TOKEN=<test-token> node scripts/verify-proxy.mjs
```

| 验证层 | 结果 |
|---|---|
| Node 语法检查 | ✅ 代理与两份验证脚本全部通过 |
| 启动页脚本回归 | ✅ 7 组地址解析 + Web 不存令牌 + fragment 交接全部通过 |
| 真实 dsh HTTP 矩阵 | ✅ 27/27 |
| 真实 dsh HTTPS/WSS 矩阵 | ✅ 27/27 |
| 真实浏览器 E2E | ✅ 浏览器打开代理启动页 → 输入真实 6 位配对码 → 进入 DeepSeek Harness UI → 刷新后仍保持会话；地址栏无令牌，控制台无错误/警告 |
| `DSH_LAUNCHER=off` | ✅ `/` 返回 401，`/launch` 返回 404 |

## 3. 当前边界

- 设备令牌 30 天自动过期，当前无单设备吊销；旋转 `DSH_REMOTE_TOKEN` 会吊销全部设备。
- 明文 HTTP 只适合可信局域网；公网必须由 dsh-remote 或前置反向代理提供可信 HTTPS。
- 浏览器 E2E 已覆盖桌面 Chromium；移动端 App 和移动浏览器真机验证留到下一阶段，不能由本阶段结果推定为已通过。
