# 06 阶段 2：配对码 + 可选 TLS — 实施与验证记录

状态：**已完成（2026-08-14）**。决策见 [ADR-0006](decisions/ADR-0006-pairing-code-and-tls.md)。本文记录当时实现；其中“配对码直接返回主令牌”的安全模型已被 [ADR-0008](decisions/ADR-0008-device-session-and-web-hardening.md) 取代，当前实现见 [09](09-web-security-hardening.md)。

## 1. 交付内容

| 部件 | 变更 |
|---|---|
| `proxy/dsh-remote.mjs` | 新增 `POST /pair/new`（主令牌签发 6 位配对码）与 `POST /pair`（公开、CORS、兑码得令牌）；单码单用、10 分钟 TTL、源 IP 10 次/分钟限速；启动时自动打印一个初始配对码。可选 TLS：`DSH_TLS_CERT`+`DSH_TLS_KEY` 同设即 HTTPS/WSS 监听，Cookie 自动加 `Secure` |
| `app/www/index.html` | 启动页改双模式标签：默认"配对码连接"（地址 + 6 位码，主令牌不上手机）；"令牌连接"保留为高级入口；已保存主机两种模式都可继续 |
| `scripts/verify-proxy.mjs` | 冒烟矩阵从 10 项扩到 17 项（配对生命周期：未授权 401、签发、预检 204、错码 403、兑码得令牌、单用防重放、突发限速 429）；支持 `PROXY_URL=https://…` + `DSH_VERIFY_INSECURE_TLS=1` 的 TLS 变体 |
| `scripts/cdp-android-e2e.py` | 支持 `pair`/`token` 两种驱动模式 |
| `verify-proxy.yml` | CI 增加 TLS 变体：openssl 自签证书 → 第二个代理实例 → 完整 17 项复跑 |

## 2. 验证矩阵（本阶段新增项）

| # | 用例 | 结果 |
|---|---|---|
| 13 | `POST /pair/new` 无主令牌 | 401 |
| 14 | `POST /pair/new` 携 Bearer | 200，6 位数字码 |
| 15 | `OPTIONS /pair` 预检 | 204 + `Access-Control-Allow-Origin: *` |
| 16 | `POST /pair` 错码 | 403 |
| 17 | `POST /pair` 正码 | 200，返回主令牌 |
| 18 | 同码重放 | 403（单次使用） |
| 19 | 12 次连错突发 | 出现 429（限速生效） |
| 20 | 上述 1–19 在 HTTPS/WSS 变体复跑 | 全过（WSS 握手 101） |
| 21 | Android 模拟器配对全流程（真实签发码 → 启动页配对模式 → 落地 dsh UI） | 通过，截图 `android-pair-e2e.png` |
| 22 | iOS WebKit 渲染新版启动页（配对码标签默认激活） | 通过，截图 `ios-pair-launcher.png` |

CI：三条流水线在阶段 2 推送后全绿（含新增 TLS 变体）。

## 3. 使用方式（配对）

```sh
# 主机：照常两个进程
npx @deepseek-ai/dsh web --port 3080
DSH_REMOTE_TOKEN=$(openssl rand -hex 16) node proxy/dsh-remote.mjs
# 终端打印：pairing code 847291 — single use, expires in 10 min

# 加设备时再签一个：
curl -X POST -H "Authorization: Bearer $DSH_REMOTE_TOKEN" http://127.0.0.1:3081/pair/new

# 手机：启动页默认就是配对码模式，填主机地址 + 6 位码即可
```

## 4. 使用方式（TLS，公网部署）

```sh
DSH_REMOTE_TOKEN=<token> \
DSH_TLS_CERT=/path/to/fullchain.pem DSH_TLS_KEY=/path/to/privkey.pem \
DSH_LISTEN_PORT=443 node proxy/dsh-remote.mjs
```

证书永远由部署方提供（ADR-0006 记录了为什么不做自签自动信任：双端 WebView 都无法程序化信任自签证书，装 CA 的摩擦违背"下载即用"）。公网部署的推荐形态是 Caddy/Nginx 终结 TLS 反代到 dsh-remote，或直接把证书交给 dsh-remote。

## 5. 已知边界

- 配对码经明文可见：仅限局域网窗口期威胁模型（10 分钟、单用、限速）；公网必须 TLS。
- 自签证书场景下 iOS/Android WebView 依旧会拦——这是平台行为，不是缺陷；局域网请用明文 + 配对码，公网请用真证书。
- 摄像头扫码（配对链接二维码）留到阶段 3：模拟器无法真实验证，且需要原生扫码依赖。
- 本机 Xcode 26.6 的 xcodebuild 在被中断后会在 SPM 解析阶段挂起（`waitForRemoteSourcePackagesToFinishLoading`）；CI 的 macos runner 无此问题。本地全量重建前先 `pkill -f xcodebuild` 并删除对应 `ios/build`。
