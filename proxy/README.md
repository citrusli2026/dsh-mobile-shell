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

手机与电脑连同一局域网，App 启动页填 `http://<电脑局域网IP>:3081` + 配对码（或令牌）即可。

## 配对码（推荐给手机用）

- 启动时终端打印一个初始配对码（6 位数字，单次使用，10 分钟有效）。
- 需要更多：`curl -X POST -H "Authorization: Bearer <token>" http://127.0.0.1:3081/pair/new`。
- App 端用配对码兑换真令牌并记忆；主令牌从不出现在手机上。错误码 403，突发尝试限速 429。

## TLS（公网部署）

```sh
DSH_REMOTE_TOKEN=<token> DSH_TLS_CERT=/path/fullchain.pem DSH_TLS_KEY=/path/privkey.pem node proxy/dsh-remote.mjs
```

证书由部署方提供（域名证书 / Caddy / 既有反代）；双端 WebView 不信任自签证书，因此代理不自签（ADR-0006）。局域网继续用明文 + 配对码即可。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_REMOTE_TOKEN` | （必填） | 主令牌，常量时间比较 |
| `DSH_LISTEN_HOST` / `DSH_LISTEN_PORT` | `0.0.0.0` / `3081` | 代理监听地址 |
| `DSH_TARGET_HOST` / `DSH_TARGET_PORT` | `127.0.0.1` / `3080` | 上游 dsh web 地址 |
| `DSH_TLS_CERT` / `DSH_TLS_KEY` | （可选，须同设） | PEM 证书/私钥路径，设置后按 HTTPS 监听 |
| `DSH_LAUNCHER` | 默认 `../app/www/index.html` | 启动页路径；`off` 关闭 Web 模式；显式路径不可读则启动失败 |

## 工作原理（简）

- 所有 HTTP 请求与 WS 握手先过令牌门（`?token=` 登录种 Cookie / Cookie / Bearer 三选一），未通过一律 401/403——例外是 Web 模式（ADR-0007）：未授权的 `GET /` 与 `/launch` 返回静态启动页（不含秘密），`/api`、WS 与 UI 资产仍全部有门。
- 转发时把 Host 改写为 loopback 并剥离 Origin，使上游 `/api` 信任围栏按 loopback 语义通过；跨站防护由令牌门承担。
- `GET /healthz` 无需令牌（`Access-Control-Allow-Origin: *`），只回答"代理活着"，供 App 启动页预检。

## 当前限制

- 单共享令牌，无多用户/吊销。
- 明文模式下请勿暴露公网；公网部署必须配 TLS。

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

From the phone app: enter `http://<host-LAN-IP>:3081` plus the pairing code (preferred — the master token never touches the phone) or the master token.

- Mint more codes: `curl -X POST -H "Authorization: Bearer <token>" http://127.0.0.1:3081/pair/new`
- TLS for public deployments: set `DSH_TLS_CERT` + `DSH_TLS_KEY` (user-supplied certs only; stock WebViews reject self-signed, see ADR-0006).
- Every HTTP request and WS handshake is gated; `/healthz` is tokenless and only proves reachability.

**Limitations:** single shared token (no per-user revocation); never expose the plain-HTTP mode to the public internet.
