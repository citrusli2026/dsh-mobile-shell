# 08 Web 模式：浏览器零安装直连 — 实施与验证记录

状态：**已完成（2026-08-15）**。决策见 [ADR-0007](decisions/ADR-0007-web-mode-launcher.md)。本文记录 Web 模式首次落地；当前设备会话与安全加固见 [ADR-0008](decisions/ADR-0008-device-session-and-web-hardening.md) 和 [09](09-web-security-hardening.md)。

## 1. 目标与形态

v0.2.0 之前，用手机必须先装 App。本阶段让 dsh-remote 自己伺服启动页：任何浏览器（手机/桌面）打开 `http://<主机IP>:3081/`，未授权访客看到的就是配对启动页，输 6 位配对码即进入 dsh UI——零安装、零地址输入（Web 模式下地址即当前源，输入框隐藏）。

## 2. 改动清单

| 文件 | 改动 |
|---|---|
| `proxy/dsh-remote.mjs` | 启动页解析（`DSH_LAUNCHER=<路径>` → 仓库默认 `app/www/index.html` → 找不到则关闭并日志说明；`DSH_LAUNCHER=off` 强制关闭、显式路径不可读则启动即失败）。未授权 `GET /`、`/index.html` 直出启动页（200，`no-store`）；`GET /launch` 始终可访问（供已登录用户更换主机）。门不变：`/api`、WS、UI 资产仍需令牌 |
| `app/www/index.html` | 同一份启动页双载体：以 `window.Capacitor` 是否存在区分 App/浏览器。Web 模式下隐藏地址框、`location.origin` 即主机、显示"当前主机"行；App 内行为不变。页首加 `<!-- dsh-remote launcher -->` 标记作为冒烟断言点 |
| `scripts/verify-proxy.mjs` | "未授权 GET / → 401"与"错令牌 → 401"改为断言启动页（200 + 标记）；新增 `/launch` 用例；矩阵 17 → 18 项 |
| `.github/workflows/verify-proxy.yml` | 新增第三变体：`DSH_LAUNCHER=off` 实例断言未授权 `GET /` → 401、`/launch` → 404 |

## 3. 使用方式（Web 模式）

```sh
# 主机侧不变，仍是两条命令
npx @deepseek-ai/dsh web --port 3080
DSH_REMOTE_TOKEN=$(openssl rand -hex 16) node proxy/dsh-remote.mjs
```

普通用户从仓库根目录运行 `node scripts/start-lan.mjs`，手机/桌面浏览器扫描终端二维码并确认一次即可进入；无需输入代理地址或 6 位配对码。高级用户仍可打开终端打印的代理地址（如 `http://192.168.1.10:3081/`）手工配对。启动页同时仍打包在 App 内，两条路径共用同一配对与安全模型。

## 4. 验证记录（2026-08-15，本机）

| # | 用例 | 结果 |
|---|---|---|
| 1 | curl 面：未授权 `/` → 200 启动页含标记；错令牌 → 200 启动页；`/launch` → 200；`/api` 无令牌 → 401；携 cookie `/` → 真 UI | ✅ |
| 2 | `DSH_LAUNCHER=off` 实例：`/` → 401、`/launch` → 404 | ✅ |
| 3 | verify-proxy 18 项矩阵对在线实例 | ✅ 全过 |
| 4 | 浏览器 E2E：Chromium（移动视口 390×844）经**局域网 IP** 打开代理 → Web 模式断言（`body.web`、地址框隐藏、"当前主机"行正确）→ 真实签发码配对 → 落地 dsh UI | ✅ 截图 `e2e-webmode-landed.png` |
| 5 | App 回归（重打 debug APK 装入 Android 15 模拟器）：全新配对（地址框**可见**、`window.Capacitor` 路径正确）→ 落地 dsh UI | ✅ |
| 6 | App 回归 A2：杀进程重开 →"已保存的主机"卡片 →"继续连接"直达 UI | ✅ |

## 5. 发现与限制

- **`adb install -r` 重装会清掉 WebView localStorage**：重装后"已保存的主机"消失，需重新配对。App 正常使用（杀进程/重启）不受影响；覆盖安装视为重置连接，记录为已知行为。
- **模拟器 Chrome 未纳入 CDP E2E**：API35 模拟器镜像的 Chrome 不开放 CDP（无 `chrome_devtools_remote`，`chrome-command-line` 机制被忽略）。当前 Web E2E 由桌面/移动 Chromium 与 WebKit 覆盖，网络路径与真机一致；实体移动浏览器渲染差异仍留真机清单。
- 实体 iOS Safari 的 Web 模式仍未测——本轮已用 Playwright WebKit 覆盖 Safari 引擎级行为，但真机 Safari 的后台、网络和系统 WebView 差异仍需 E 系列确认。
- 扫码配对链接（阶段 3 项）在 Web 模式下天然成立：链接即代理地址，届时一并验证。
