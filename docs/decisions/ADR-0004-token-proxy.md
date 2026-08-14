# ADR-0004 局域网暴露：令牌反代（dsh-remote），dsh 保持 loopback

- 状态：已接受（2026-08-14）
- 依据：[ADR-0002](ADR-0002-architecture-remote-client.md) 第 3 条；上游安全现状（`01-project-analysis.md` F5）

## 背景

上游 `dsh web --host 0.0.0.0` 被刻意禁用（`packages/bundle/web-app/src/startup.ts`："intentionally not supported yet for safety: it would expose remote code execution to the network"），主机无认证层（`packages/client/connection/src/api-request-trust.ts`）。移动 App 要连主机，必须有人解决"网络可达 + 认证"两件事。

上游 `/api` 信任围栏的事实（本轮源码核查）：Host 头必须是 loopback 或 `trustedHosts` 条目（无端口条目匹配任意端口的主机名）；若带 Origin 必须与 Host 逐字相等；`sec-fetch-site: cross-site` 直接拒绝。围栏注释明确：认证不在其职责内。

## 决策

1. **dsh web 永远绑定 127.0.0.1**（尊重上游安全立场），新建 `proxy/dsh-remote.mjs`：零依赖 Node 反代，监听 0.0.0.0:3081，对每一个 HTTP 请求与每一次 WebSocket 握手强制校验令牌，通过才转发到 loopback。
2. **令牌三种出示方式**：`?token=` 登录（302 + 种 HttpOnly Cookie）、`dsh_token` Cookie（会话）、`Authorization: Bearer`（非浏览器客户端）。常量时间比较；未配置 `DSH_REMOTE_TOKEN` 直接拒绝启动。
3. **转发时改写 Host 为 loopback、剥离 Origin**：让上游围栏在 loopback 语义下通过；跨站边界由代理的令牌门承担（Cookie `SameSite=Lax`）。`/healthz` 无认证但带 `Access-Control-Allow-Origin: *`，仅证明可达性，供 App 启动页预检。
4. **PoC 阶段允许明文**：仅可信局域网/组网（Tailscale 等）使用；双端工程相应放开明文开关（Android `usesCleartextTraffic`、iOS `NSAllowsArbitraryLoads`），阶段 2 代理终结 TLS 后必须收回。
5. 长连接兼容：SSE 与 WS 由代理透明管道转发，禁用 Node 默认 request/headers/socket 超时。

## 后果

- 上游零改动；`--host 0.0.0.0` 禁令保持有效，暴露面收敛为"代理 + 一个共享密钥"。
- 共享密钥模型的局限：无用户区分、无吊销列表、明文阶段可被局域网嗅探——阶段 2 的 TLS 与更强的配对（短期二维码令牌换长期设备令牌）在此 ADR 基础上演进，不另起架构。
- 被否决方案：
  - **`--patch` 覆盖 webserver 行直连 0.0.0.0**：零新代码，但绕过了上游刻意的安全禁令且仍然没有认证，等于把主机 shell 裸暴露给局域网，否决。
  - **SSH 隧道**：手机端不可操作，否决。
  - **直接上游 PR 优先**：正确终局但评审周期不可控；代理形态与其不冲突（上游合入认证后代理可退化为纯 TLS 终结）。
- 遗留：自签名证书在 WKWebView/WebView 中的信任 UX 未解决，TLS 化时另评。

## 取代关系

落实 ADR-0002 第 3 条的"外挂代理兜底"路径；不取代其"上游认证 PR 为正解"的判断。
