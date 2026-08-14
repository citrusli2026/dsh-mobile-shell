# 07 真机验证清单（阶段 3 入口）

状态：**模拟器预演已过（见第 6 节），真机项待执行**。本清单用于在真实手机（而非模拟器）上验收 v0.2.0。模拟器已覆盖的项在 [05](05-phase1-poc.md)、[06](06-phase2-pairing-tls.md) 与本文件第 6 节；真机要回答的是：真实无线网络的时延与抖动、系统 WebView 差异、后台/熄屏重连、触控与键盘交互。

## 0. 前置条件

- 电脑：Node `^22.19 || >=24`；手机与电脑在**同一局域网**（无 AP 隔离；路由器"访客网络"常带隔离，避开）。
- 要跑真实模型回合：在主机侧配置 `DEEPSEEK_API_KEY`（根 `.env` 或环境变量）。
- 生成主令牌：`openssl rand -hex 16`（自己保存好，不输入手机）。

## 1. 主机侧一次性准备

```sh
# 1) 安装移动 UI 插件到 web profile（可选但建议；小屏导航体验靠它）
npx @deepseek-ai/dsh plugin --profile web add git+https://github.com/citrusli2026/dsh-mobile-ui.git
# 若 pnpm 拦截 prepare 构建脚本：按终端提示把对应 key 加进 profile 目录
# pnpm-workspace.yaml 的 allowBuilds 后重跑该命令（上游 strictDepBuilds 的既定行为）。

# 2) 启动主机 + 代理（保持两个进程）
npx @deepseek-ai/dsh web --port 3080
DSH_REMOTE_TOKEN=<上一步的令牌> node proxy/dsh-remote.mjs
# 记录终端打印的 6 位配对码；用完或过期后签发新码：
#   curl -X POST -H "Authorization: Bearer <令牌>" http://127.0.0.1:3081/pair/new
```

查电脑的局域网 IP：macOS `ipconfig getifaddr en0`；Windows `ipconfig`；Linux `hostname -I`。

## 2. 安装 App

Web 模式（v0.3.0 起）无需安装：手机浏览器直接打开 `http://<电脑IP>:3081/` 即是启动页，见 A0 与 [08](08-web-mode.md)。App 安装路径：

- **Android**：手机浏览器打开 Release 资产链接（国内加前缀 `https://ghproxy.net/`）：
  `https://github.com/citrusli2026/dsh-mobile-shell/releases/download/v0.2.0/dsh-mobile-shell-v0.2.0-android-debug.apk`
  下载后安装（允许"未知来源"）；或电脑 `adb install`。
- **iOS**：无免签直装路径。开发者账号用 Xcode 直接构建到真机（`app/ios`，`generic/platform=iOS`，选择自己的签名团队），或等 TestFlight（阶段 3 事项）。iOS 真机项标 E 系列。

## 3. 验证清单

结果记 ✅/❌/⚠️（可用但有碍）；❌/⚠️ 项附现象与日志（`adb logcat | grep -i capacitor`，iOS 用 Safari Web Inspector）。

### A. 连接与配对

- [ ] A0 Web 模式（v0.3.0 起）：手机浏览器直接打开 `http://<电脑IP>:3081/` → 出现启动页（地址框已隐藏）→ 输配对码进入 UI，无需装 App
- [ ] A1 启动页默认在"配对码连接"：填 `http://<电脑IP>:3081` + 6 位码 → 进入 dsh UI，无报错横幅
- [ ] A2 杀掉 App 重开 → 出现"已保存的主机"卡片 → "继续连接"直达 UI（记忆生效）
- [ ] A3 故意输错配对码 → 明确错误提示；同一码用第二次 → 失败提示（单用生效）
- [ ] A4 使用中关开一次 Wi-Fi → 事件流自动恢复（记录耗时与是否需手动刷新）

### B. 功能与桌面一致性（核心验收）

- [ ] B1 选择/创建工作区成功
- [ ] B2 发起一个真实模型回合：流式输出、思考过程、markdown 渲染正常
- [ ] B3 触发一个需审批的 Bash 命令 → 审批界面可操作，批准后命令在**主机**执行（证明执行链路完整）
- [ ] B4 终端/工具结果卡片完整可滚动；长输出不卡死
- [ ] B5 多会话切换、杀掉 App 重进后会话历史完整

### C. 移动 UI 插件（装了插件且视口 ≤ 768px）

- [ ] C1 输入框上方出现操作条（`会话` / `新会话`）
- [ ] C2 `会话`打开全屏抽屉：会话列表、状态点（待处理/运行中/已完成）、当前高亮；等待审批的会话数显示在徽标
- [ ] C3 桌面浏览器打开同一主机（>768px）：**不**出现移动 chrome（不回归桌面）

### D. 系统交互

- [ ] D1 横竖屏旋转不崩、不错位
- [ ] D2 切后台 5 分钟回前台 → 会话状态与流式恢复
- [ ] D3 熄屏 10 分钟解锁 → WS 自动重连（记录是否需手动干预）
- [ ] D4 系统键盘弹出时输入框不被遮挡（safe area / IME 适配）

### E. iOS 真机（有签名条件时）

- [ ] E1 开发签名/TestFlight 安装成功
- [ ] E2 复跑 A1–A4、B1–B5、C1–C3
- [ ] E3 应用内 WKWebView 配对跳转正常（模拟器无法脚本化验证的遗留项，见 06 第 5 节）

## 4. 验收通过标准

A 全过 + B 全过（允许 B4 记录性能数据）；C/D/E 的 ❌ 项各开一个 issue 跟踪。通过后：v0.2.0 摘掉"PoC"表述，README 路线图阶段 3 的"真机确认"项勾掉。

## 5. 常见问题

| 现象 | 排查 |
|---|---|
| 启动页提示"连不上主机：超时" | 手机与电脑是否同网段；电脑防火墙是否放行 3081；`curl http://<电脑IP>:3081/healthz` 用手机浏览器验证 |
| 配对码一直 403 | 码已过期或被用过；回主机签发新码 |
| 模型回合报错 | 主机未配 `DEEPSEEK_API_KEY`，与 App 无关；桌面浏览器复现确认 |
| 看不到底部导航/操作条 | 插件未安装或视口大于断点；`dsh plugin --profile web ls` 确认；断点配置见插件 README |

## 6. 模拟器预演记录（2026-08-14）

真机执行前的最后一轮模拟器端到端复验。环境：Android 15 模拟器（AVD `SubScope-Pixel6-API35`）；主机 `dsh web` 0.1.0-rc.6（127.0.0.1:3090）+ dsh-remote（0.0.0.0:3091，配对码模式）；App 为 v0.2.0 debug APK（本地构建，与 Release 同一产物链）。模拟器经**局域网 IP**（192.168.1.26）访问主机，与真机走同一网络路径；UI 驱动用 `adb forward` + CDP（`scripts/cdp-android-e2e.py`）。

| 清单项 | 结果 | 证据 |
|---|---|---|
| A1 配对码连接 | ✅ 兑码成功，落地 dsh UI（标题 `DeepSeek Harness`，工作区选择页正常渲染） | 截图 `e2e-v020-landed.png` |
| A2 记忆重连 | ✅ 杀进程重开出现"已保存的主机"卡片（地址正确），"继续连接"免输码直达 UI | 截图 `e2e-v020-saved-host.png` |
| A3 错码 / 重放 | ✅ 错误码 403；同一码二次兑换 403（单用生效）；无令牌访问 401 | curl 实录 |
| 代理冒烟 17 项 | ✅ 全部通过，含 WS 无令牌 403 / 携 cookie 101（对 `/api/events.mux`） | `verify-proxy.mjs` 输出 |

未覆盖、留给真机的项：B2/B3 需要主机配置 `DEEPSEEK_API_KEY`（本机未配置，模型回合与审批链路未跑）；A4 与 D 系列的断网恢复、后台、熄屏只有真实无线电环境才有意义；C 系列依赖移动 UI 插件安装（本轮未装）；E 系列为 iOS 真机项。
