# dsh-remote — dsh web 的令牌反代 / token-guard reverse proxy

[English](#english) | [中文](#中文)

<a id="中文"></a>

让局域网内的手机安全地连接本机 `dsh web`，而不违背上游"禁止绑定 0.0.0.0"的安全立场。零依赖，Node ≥ 20 直接运行。决策背景见 [ADR-0004](../docs/decisions/ADR-0004-token-proxy.md) 与 [ADR-0006](../docs/decisions/ADR-0006-pairing-code-and-tls.md)。

## 用法

```sh
# 1) 主机照常启动（保持默认 loopback）
npx @deepseek-ai/dsh web --port 3080

# 2) 启动代理（令牌至少 8 位，建议 openssl rand -hex 16）
DSH_REMOTE_TOKEN=<token> node proxy/dsh-remote.mjs
# dsh-remote: http://0.0.0.0:3081 -> http://127.0.0.1:3080 (token required)
# dsh-remote: pairing code 847291 — single use, expires in 10 min
```

手机与电脑连同一局域网：浏览器直接打开 `http://<电脑局域网IP>:3081/`，或在 App 启动页填写该地址；输入终端打印的配对码即可进入。

## 配对码（推荐给手机用）

- 启动时终端打印一个初始配对码（6 位数字，单次使用，10 分钟有效）。
- 需要更多：`curl -X POST -H "Authorization: Bearer <token>" http://127.0.0.1:3081/pair/new`。
- 配对成功后签发一个随机 ID、HMAC 签名、30 天有效的**设备令牌**；浏览器只得到 HttpOnly Cookie，响应正文不含令牌。App 兼容路径只记忆设备令牌。主令牌由主机持有，负责签发配对码和设备令牌签名；旧客户端 Bearer 访问仍作为兼容入口保留。
- 错误码 403，突发尝试限速 429；修改 `DSH_REMOTE_TOKEN` 会立即使全部既有设备令牌失效。

## TLS（公网部署）

```sh
DSH_REMOTE_TOKEN=<token> DSH_TLS_CERT=/path/fullchain.pem DSH_TLS_KEY=/path/privkey.pem node proxy/dsh-remote.mjs
```

证书由部署方提供（域名证书 / Caddy / 既有反代）；双端 WebView 不信任自签证书，因此代理不自签（ADR-0006）。局域网继续用明文 + 配对码即可。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_REMOTE_TOKEN` | （必填） | 仅主机持有的主令牌；常量时间比较，同时作为设备令牌签名密钥 |
| `DSH_LISTEN_HOST` / `DSH_LISTEN_PORT` | `0.0.0.0` / `3081` | 代理监听地址 |
| `DSH_TARGET_HOST` / `DSH_TARGET_PORT` | `127.0.0.1` / `3080` | 上游 dsh web 地址 |
| `DSH_TLS_CERT` / `DSH_TLS_KEY` | （可选，须同设） | PEM 证书/私钥路径，设置后按 HTTPS 监听 |
| `DSH_LAUNCHER` | 默认 `../app/www/index.html` | 启动页路径；`off` 关闭 Web 模式；显式路径不可读则启动失败 |

## 工作原理（简）

- 所有 HTTP 请求与 WS 握手先过令牌门（HttpOnly 设备 Cookie / Bearer；`?token=` 仅保留为兼容入口且会先降权为设备令牌），未通过一律 401/403——例外是 Web 模式（ADR-0007）：未授权的 `GET /` 与 `/launch` 返回静态启动页（不含秘密），`/api`、WS 与 UI 资产仍全部有门。
- 浏览器配对响应直接种 HttpOnly 设备 Cookie，不把主令牌或设备令牌交给页面 JavaScript；请求 Origin 与 Host 不属于同一 authority 时，已认证 API/WS 也会拒绝（允许 Caddy/Nginx 在前方终止 TLS）。
- 转发时把 Host 改写为 loopback 并剥离 Origin，使上游 `/api` 信任围栏按 loopback 语义通过；跨站防护由令牌门承担。
- `GET /healthz` 无需令牌（`Access-Control-Allow-Origin: *`），只回答"代理活着"，供 App 启动页预检。

## 当前限制

- 设备令牌 30 天过期；暂未提供单设备吊销接口，旋转主令牌会吊销全部设备。
- 明文模式下请勿暴露公网；公网部署必须配 TLS。

## Web 验证状态

2026-08-15 已使用真实发布版 `dsh web` 验证通过：HTTP 27/27、HTTPS/WSS 27/27 自动化矩阵全部通过；真实 Chromium 完成启动页配对、进入 DeepSeek Harness、刷新后保持会话。详见 [验证实录](../docs/09-web-security-hardening.md)。移动端 App 不包含在本次通过结论中。

---

<a id="english"></a>

# English

A token-guard reverse proxy that lets phones on the LAN reach a `dsh web` host without violating upstream's deliberate refusal to bind `0.0.0.0`. Zero dependencies, Node ≥ 20. Rationale: [ADR-0004](../docs/decisions/ADR-0004-token-proxy.md), [ADR-0006](../docs/decisions/ADR-0006-pairing-code-and-tls.md).

## Usage

```sh
npx @deepseek-ai/dsh web --port 3080            # host stays on loopback
DSH_REMOTE_TOKEN=<token> node proxy/dsh-remote.mjs
# prints an initial 6-digit pairing code (single use, 10-min TTL)
```

Open `http://<host-LAN-IP>:3081/` in a browser, or enter that address in the phone app, then use the printed pairing code. Direct master-token entry remains an advanced compatibility path.

- Pairing issues a signed 30-day device credential. Browsers receive only an HttpOnly cookie; the master token never appears in the response body or browser storage.
- Mint more codes: `curl -X POST -H "Authorization: Bearer <master-token>" http://127.0.0.1:3081/pair/new`
- TLS for public deployments: set `DSH_TLS_CERT` + `DSH_TLS_KEY` (user-supplied certs only; stock WebViews reject self-signed, see ADR-0006).
- Every HTTP request and WS handshake is gated; `/healthz` is tokenless and only proves reachability.

**Limitations:** device credentials expire after 30 days and currently have no individual revocation endpoint; rotating the master token revokes them all. Never expose the plain-HTTP mode to the public internet.

**Web verification:** on 2026-08-15, the real published `dsh web` passed all 27 HTTP and all 27 HTTPS/WSS matrix cases, plus a real Chromium pairing-and-reload E2E. See the [verification report](../docs/09-web-security-hardening.md). Mobile-app verification is tracked separately.
