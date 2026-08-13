# dsh-remote — dsh web 的令牌反代

让局域网内的手机安全地连接本机 `dsh web`，而不违背上游"禁止绑定 0.0.0.0"的安全立场。零依赖，Node ≥ 20 直接运行。决策背景见 [ADR-0004](../docs/decisions/ADR-0004-token-proxy.md)。

## 用法

```sh
# 1) 主机照常启动（保持默认 loopback）
dsh web                       # http://127.0.0.1:3080

# 2) 启动代理（令牌至少 8 位，建议 openssl rand -hex 16）
DSH_REMOTE_TOKEN=<token> node dsh-remote.mjs
# dsh-remote: http://0.0.0.0:3081 -> http://127.0.0.1:3080 (token required)
```

手机与电脑连同一局域网，App 启动页填 `http://<电脑局域网IP>:3081` 与同一令牌即可。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_REMOTE_TOKEN` | （必填） | 共享令牌，常量时间比较 |
| `DSH_LISTEN_HOST` / `DSH_LISTEN_PORT` | `0.0.0.0` / `3081` | 代理监听地址 |
| `DSH_TARGET_HOST` / `DSH_TARGET_PORT` | `127.0.0.1` / `3080` | 上游 dsh web 地址 |

## 工作原理（简）

- 所有 HTTP 请求与 WS 握手先过令牌门（`?token=` 登录种 Cookie / Cookie / Bearer 三选一），未通过一律 401/403。
- 转发时把 Host 改写为 loopback 并剥离 Origin，使上游 `/api` 信任围栏按 loopback 语义通过；跨站防护由令牌门承担。
- `GET /healthz` 无需令牌（`Access-Control-Allow-Origin: *`），只回答"代理活着"，供 App 启动页预检。

## 当前限制（PoC）

- 明文 HTTP：仅限可信局域网或 Tailscale 等组网内使用；阶段 2 在代理层终结 TLS。
- 单共享令牌：无多用户/吊销；公网暴露前必须完成阶段 2。
