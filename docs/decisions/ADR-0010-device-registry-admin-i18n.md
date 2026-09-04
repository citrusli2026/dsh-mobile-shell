# ADR-0010 设备登记与生命周期、管理台与 Web 国际化

状态：已接受（2026-09-04）

## 背景

路线图（docs/10-roadmap-to-release.md）W2–W4 要求：Web 用户能看到"这台设备是谁、何时过期"，能退出或单独吊销设备；不读源码也能部署、排错、管理；启动页支持中英文、无障碍与窄屏。此前设备令牌只有 HMAC 签名 + 30 天到期，无法单独吊销，也没有管理入口。

## 决策

### 1. 设备登记文件（W2）

- 新增 `proxy/device-store.mjs`；路径由 `DSH_STATE_FILE` 指定，默认 `proxy/dsh-devices.json`。
- 只存设备元数据：`id / name / issuedAt / expiresAt / revokedAt / lastSeenAt`。**不存 bearer**——设备令牌是自持的（HMAC payload），登记表只回答"这个 id 是否仍有效"。
- 写入为临时文件（0600）+ `fsync` + 原子 `rename`。
- 文件损坏或版本不支持 → **启动即退出（fail closed）**，错误信息给出恢复路径：删除文件即吊销全部设备、重新配对。
- 令牌校验顺序：HMAC → 到期 → 登记/吊销状态（纯内存，无 I/O）；`lastSeenAt` 以 60 秒节流批量落盘。
- 旋转 `DSH_REMOTE_TOKEN` 仍一次性吊销全部设备（HMAC 密钥变更），与登记表正交。

### 2. 生命周期端点（W2）

- `GET /session/check`：当前 cookie/bearer 是否有效，返回设备名与到期时间；驱动启动页"会话已过期"态。
- `POST /device/logout`：吊销当前设备并清 Cookie；幂等，匿名调用也返回 200（浏览器永不死路）。
- `GET /devices`、`POST /devices/revoke {id}`：仅主令牌。吊销立即对 HTTP 与 WS 生效。

### 3. 管理台与部署易用性（W3）

- `GET /admin`：静态页（`app/www/admin.html`），与启动页同级、随 Web 构件分发。页面本身无秘密：主令牌每次使用时输入、仅存内存。提供设备列表、单独吊销、签发新配对码、下载 SVG 二维码（`GET /pair/qr.svg`，主令牌门禁、no-store）。
- `GET /healthz` 增加 `upstream` 字段（惰性探测、5 秒缓存），启动页据此区分"代理在线但上游 dsh 未运行"。
- 启动日志列出监听地址、TLS 状态、可扫描 pairing bases、上游健康、登记文件路径与活跃设备数。
- `DSH_PAIR_RATE_MAX`（默认 10）成为显式部署旋钮，测试环境调高。

### 4. 国际化与无障碍（W4）

- 启动页文案抽取为 zh/en 字典；默认中文，按浏览器语言协商，`dsh.lang` 手动切换持久化。E2E 断言中文界面并以 `locale: zh-CN` 固定。
- 关键元素补 `data-testid`；状态行 `role="status"` + `aria-live`；Tab/focus-visible 完整；320px 窄屏与 200% 缩放可用。
- 新发现的真实缺陷一并修复：启动页已打开时再扫新码只有 hash 变化、不触发加载——新增 `hashchange` 处理重新预填。

## 后果

- 启动页/管理台随 `npm run package:web` 构件分发；外部主机升级即获得全部能力。
- 登记文件是新的有状态文件：备份它即保留设备会话；删除它即全员重新配对（错误信息中明示）。
- 限流默认值不变；公网部署仍要求可信 HTTPS。
