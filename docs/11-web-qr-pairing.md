# 11 Web 二维码配对：实施与验证记录

状态：**已完成（2026-08-15）**。决策见 [ADR-0009](decisions/ADR-0009-web-qr-pairing.md)。本阶段继续只验证 Web，Android/iOS 优先级已后移。

## 1. 用户流程

```text
运行 `node scripts/start-lan.mjs`
  → 脚本自动启动 loopback `dsh web` 与局域网代理，选择私有 IPv4 并生成随机主令牌
  → 终端打印单次码、可复制 /launch#pair=… 链接和二维码
  → 手机扫码
  → 启动页立即清理 fragment 并预填 6 位码
  → 用户确认一次
  → 服务端签发 HttpOnly 设备 Cookie
  → 进入 DeepSeek Harness
```

需要新设备时，在运行代理的交互终端输入 `n` 回车即可生成新码/链接/QR。后台部署调用原有 `POST /pair/new`，响应现在包含同码的 `pairingUrls`。

## 2. 实现

| 文件 | 内容 |
|---|---|
| `proxy/pairing-qr.mjs` | public Origin 校验、LAN IPv4 发现、安全配对 URL 和 ANSI 终端 QR 渲染 |
| `proxy/vendor/qrcodegen.mjs` | Project Nayuki v1.8.0 的 TypeScript 编译结果；完整 MIT notice 保留，无运行时 npm 依赖 |
| `scripts/start-lan.mjs` | 普通用户的一键安全入口：启动上下游、自动选私有 IPv4、拒绝公网配置、随机生成进程内主令牌 |
| `proxy/dsh-remote.mjs` | 启动/`n`/`POST /pair/new` 三条签码入口统一输出 pairing info；支持 `DSH_PUBLIC_URL`、`DSH_PAIR_QR` |
| `app/www/index.html` | 读取并立即清除 `#pair=`；有效码预填并等待确认，无效码明确报错；已有 saved host 不遮挡扫码页 |
| `scripts/verify-pairing-qr.mjs` | public URL、网卡发现、fragment URL、无长期 token 和 QR 编码快照 |
| `scripts/verify-launcher.mjs` | 扫码预填、URL 清理、不自动兑换、无效码 fail closed |

## 3. 验证结果

| 层级 | 结果 |
|---|---|
| QR/launcher 单元回归 | ✅ public URL、LAN 发现、fragment、固定编码快照、预填/无效码全部通过 |
| 交互终端 | ✅ 实际输出 ANSI QR；输入 `n` 回车生成新的码和链接 |
| 真实 dsh HTTP | ✅ 28/28，全矩阵保持通过；`/pair/new` pairing URL 结构与无 token 断言通过 |
| 真实 dsh HTTPS/WSS | ✅ 28/28，自签测试变体保持通过 |
| Chromium/WebKit 浏览器 | ✅ 桌面与移动视口共 8/8；深链打开后 URL 从 `…#pair=092792` 清理为 `/launch`，页面只预填并等待确认；确认后进入 DeepSeek Harness；刷新会话保持；重放同一深链提示无效/过期 |
| 本机 Google Chrome | ✅ 桌面项目 2/2；同一流程通过 |
| 错误配置 | ✅ `DSH_PUBLIC_URL` 含路径/查询/凭据或非 HTTP(S) 时启动失败 |
| launcher-off | ✅ `/` 401、`/launch` 404，无 Web QR 链接 |

## 4. 当前边界

- 高级 `dsh-remote` 模式在通配监听时会列出所有非 internal IPv4；推荐的 `start-lan` 模式只选择一个 RFC1918 私有 IPv4 并绑定到该地址。多网卡选错时用 `DSH_LAN_IP` 指定 Wi-Fi 地址，不要把 `DSH_PUBLIC_URL` 用在局域网启动脚本上。
- 终端 QR 依赖 ANSI 颜色和交互 TTY；`NO_COLOR`、重定向日志或 `DSH_PAIR_QR=off` 时只显示文本链接，功能不受影响。
- 当前 QR 只解决首次配对；设备列表、吊销、退出/忘记主机属于路线图 W2。
