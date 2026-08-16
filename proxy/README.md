# dsh-remote — dsh web 的令牌反代 / token-guard reverse proxy

[English](#english) | [中文](#中文)

<a id="中文"></a>

让局域网内的手机安全地连接本机 `dsh web`，而不违背上游"禁止绑定 0.0.0.0"的安全立场。零依赖，Node ≥ 20 直接运行。决策背景见 [ADR-0004](../docs/decisions/ADR-0004-token-proxy.md) 与 [ADR-0006](../docs/decisions/ADR-0006-pairing-code-and-tls.md)。

## 用法

### 推荐：三步局域网模式

从仓库根目录运行：

```sh
node scripts/start-lan.mjs
```

脚本自动启动 loopback 上的 `dsh web` 和本代理，选择一个私有局域网 IPv4，生成仅存于本次进程的随机主令牌，并打印离线 QR。手机与电脑连同一 Wi-Fi 后只需“启动 → 扫码 → 点击确认配对并连接”，不输入 IP、配对码或令牌。脚本拒绝公网地址、`0.0.0.0`、`DSH_PUBLIC_URL` 和 TLS 配置；多网卡时可用 `DSH_LAN_IP=192.168.1.23` 指定 Wi-Fi 地址。

### 高级：分开启动主机与代理

```sh
# 1) 主机照常启动（保持默认 loopback）
npx @deepseek-ai/dsh web --port 3080

# 2) 启动代理（令牌至少 8 位，建议 openssl rand -hex 16）
DSH_REMOTE_TOKEN=<token> node proxy/dsh-remote.mjs
# dsh-remote: http://0.0.0.0:3081 -> http://127.0.0.1:3080 (token required)
# dsh-remote: pairing code 847291 — single use, expires in 10 min
# dsh-remote: pairing link http://192.168.1.10:3081/launch#pair=847291
# 随后在交互终端显示二维码
```

手机与电脑连同一局域网：优先扫描终端二维码，浏览器会预填短码，确认一次即可进入；也可直接打开 `http://<电脑局域网IP>:3081/` 手输配对码。需要新码时在代理终端输入 `n` 回车。

## 配对码（推荐给手机用）

- 启动时终端打印一个初始配对码（6 位数字，单次使用，10 分钟有效）。
- 交互终端同时打印本地生成的二维码和可复制链接；二维码只包含代理 Origin + 单次码。扫码页立即清理 fragment、预填码并等待用户确认，不会被链接预览自动消耗。
- 需要更多：终端输入 `n` 回车；后台/脚本部署使用 `curl -X POST -H "Authorization: Bearer <token>" http://127.0.0.1:3081/pair/new`，JSON 会同时返回 `pairingUrls`。
- 配对成功后签发一个随机 ID、HMAC 签名、30 天有效的**设备令牌**；浏览器只得到 HttpOnly Cookie，响应正文不含令牌。App 兼容路径只记忆设备令牌。主令牌由主机持有，负责签发配对码和设备令牌签名；旧客户端 Bearer 访问仍作为兼容入口保留。
- 错误码 403，突发尝试限速 429；修改 `DSH_REMOTE_TOKEN` 会立即使全部既有设备令牌失效。

## TLS（公网部署）

```sh
DSH_REMOTE_TOKEN=<token> DSH_TLS_CERT=/path/fullchain.pem DSH_TLS_KEY=/path/privkey.pem node proxy/dsh-remote.mjs
```

证书由部署方提供（域名证书 / Caddy / 既有反代）；双端 WebView 不信任自签证书，因此代理不自签（ADR-0006）。局域网继续用明文 + 配对码即可。

若对外地址不是代理自动发现的局域网 IP（例如 Caddy 域名、Tailscale 名称或多网卡），设置 `DSH_PUBLIC_URL=https://dsh.example.com`，保证二维码指向用户实际可访问的 Origin。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_REMOTE_TOKEN` | （必填） | 仅主机持有的主令牌；常量时间比较，同时作为设备令牌签名密钥 |
| `DSH_LISTEN_HOST` / `DSH_LISTEN_PORT` | `0.0.0.0` / `3081` | 代理监听地址 |
| `DSH_TARGET_HOST` / `DSH_TARGET_PORT` | `127.0.0.1` / `3080` | 上游 dsh web 地址 |
| `DSH_TLS_CERT` / `DSH_TLS_KEY` | （可选，须同设） | PEM 证书/私钥路径，设置后按 HTTPS 监听 |
| `DSH_LAUNCHER` | 默认 `../app/www/index.html` | 启动页路径；`off` 关闭 Web 模式；显式路径不可读则启动失败 |
| `DSH_PUBLIC_URL` | 自动发现局域网 IPv4 | 二维码/配对链接使用的公开 Origin；只接受无路径、查询、fragment 和凭据的 HTTP(S) Origin |
| `DSH_PAIR_QR` | 交互终端开启 | 设为 `off` 不打印 ANSI 二维码；配对码和链接仍打印 |

## 工作原理（简）

- 所有 HTTP 请求与 WS 握手先过令牌门（HttpOnly 设备 Cookie / Bearer；`?token=` 仅保留为兼容入口且会先降权为设备令牌），未通过一律 401/403——例外是 Web 模式（ADR-0007）：未授权的 `GET /` 与 `/launch` 返回静态启动页（不含秘密），`/api`、WS 与 UI 资产仍全部有门。
- 浏览器配对响应直接种 HttpOnly 设备 Cookie，不把主令牌或设备令牌交给页面 JavaScript；请求 Origin 与 Host 不属于同一 authority 时，已认证 API/WS 也会拒绝（允许 Caddy/Nginx 在前方终止 TLS）。
- 转发时把 Host 改写为 loopback 并剥离 Origin，使上游 `/api` 信任围栏按 loopback 语义通过；跨站防护由令牌门承担。
- `GET /healthz` 无需令牌（`Access-Control-Allow-Origin: *`），只回答"代理活着"，供 App 启动页预检。

## 当前限制

- 设备令牌 30 天过期；暂未提供单设备吊销接口，旋转主令牌会吊销全部设备。
- 明文模式下请勿暴露公网；公网部署必须配 TLS。

## Web 验证状态

2026-08-15 已使用真实发布版 `dsh web` 验证通过：HTTP 28/28、HTTPS/WSS 28/28 自动化矩阵全部通过；Playwright 的 Chromium、WebKit、移动 Chromium、移动 WebKit 共 8/8 通过，本机 Google Chrome 额外 2/2 通过。覆盖 QR 深链预填、一次确认、进入 DeepSeek Harness、刷新保持会话、legacy token 查询清理和无效码拒绝。详见 [安全验证](../docs/09-web-security-hardening.md) 与 [二维码实录](../docs/11-web-qr-pairing.md)。实体 Safari 与移动端 App 不包含在本次通过结论中。

### 本地浏览器 E2E

真实 `dsh web` 和代理启动后：

```sh
npm ci --prefix proxy
npx --prefix proxy playwright install chromium webkit
DSH_REMOTE_TOKEN=<test-token> E2E_BASE_URL=http://127.0.0.1:3081 \
  npm run test:e2e --prefix proxy
# 若本机安装 Google Chrome：
E2E_USE_INSTALLED_CHROME=1 DSH_REMOTE_TOKEN=<test-token> \
  npm run test:e2e:chrome --prefix proxy
```

---

<a id="english"></a>

# English

A token-guard reverse proxy that lets phones on the LAN reach a `dsh web` host without violating upstream's deliberate refusal to bind `0.0.0.0`. Zero dependencies, Node ≥ 20. Rationale: [ADR-0004](../docs/decisions/ADR-0004-token-proxy.md), [ADR-0006](../docs/decisions/ADR-0006-pairing-code-and-tls.md).

## Usage

### Recommended: three-step LAN mode

Run this from the repository root:

```sh
node scripts/start-lan.mjs
```

The helper starts `dsh web` on loopback and this proxy, selects one private LAN IPv4, creates a fresh in-memory master token, and prints an offline QR. With the phone and computer on the same Wi-Fi, the flow is simply “start → scan → tap confirm”; there is no IP, pairing-code, or token entry. The helper rejects public addresses, `0.0.0.0`, `DSH_PUBLIC_URL`, and TLS configuration. For multiple interfaces, set `DSH_LAN_IP=192.168.1.23` to select the Wi-Fi address.

### Advanced: start the host and proxy separately

```sh
npx @deepseek-ai/dsh web --port 3080            # host stays on loopback
DSH_REMOTE_TOKEN=<token> node proxy/dsh-remote.mjs
# prints an initial code, pairing link, and terminal QR
```

Scan the terminal QR and confirm once, or open `http://<host-LAN-IP>:3081/` and enter the printed code. Enter `n` + Return in the proxy terminal to mint another QR. Direct master-token entry remains an advanced compatibility path.

- Pairing issues a signed 30-day device credential. Browsers receive only an HttpOnly cookie; the master token never appears in the response body or browser storage.
- Mint more codes: `curl -X POST -H "Authorization: Bearer <master-token>" http://127.0.0.1:3081/pair/new`
- Set `DSH_PUBLIC_URL=https://dsh.example.com` when LAN auto-discovery is not the address users should scan. Set `DSH_PAIR_QR=off` to hide only the ANSI QR.
- TLS for public deployments: set `DSH_TLS_CERT` + `DSH_TLS_KEY` (user-supplied certs only; stock WebViews reject self-signed, see ADR-0006).
- Every HTTP request and WS handshake is gated; `/healthz` is tokenless and only proves reachability.

**Limitations:** device credentials expire after 30 days and currently have no individual revocation endpoint; rotating the master token revokes them all. Never expose the plain-HTTP mode to the public internet.

**Web verification:** on 2026-08-15, the real published `dsh web` passed all 28 HTTP and all 28 HTTPS/WSS matrix cases, plus Chromium/WebKit desktop and mobile QR-prefill, confirm, reload, and replay-rejection E2E. The installed Google Chrome desktop project also passed 2/2. See the [security report](../docs/09-web-security-hardening.md) and [QR report](../docs/11-web-qr-pairing.md). Mobile-app verification is tracked separately.
