# docs — 文档索引与工作约定

本目录记录移动版项目的分析、规划与全部决策过程。

## 索引

| 文档 | 类型 | 内容 |
|---|---|---|
| [01-project-analysis.md](01-project-analysis.md) | 分析 | 上游 deepseek-harness 的架构、客户端/服务端边界 |
| [02-build-and-dependencies.md](02-build-and-dependencies.md) | 分析 | 构建流程、依赖下载清单、国内镜像加速方案 |
| [03-feasibility-analysis.md](03-feasibility-analysis.md) | 分析 | 移动端技术路线对比、可行性结论、分阶段路线图 |
| [04-mobile-ui-plugin.md](04-mobile-ui-plugin.md) | 实施 | 移动 UI 插件 dsh-mobile-ui 的实现、上游事实发现与端到端验证 |
| [05-phase1-poc.md](05-phase1-poc.md) | 实录 | 阶段 1 PoC：壳/代理运行方法、双端局域网验证矩阵、踩坑记录、已知限制 |
| [06-phase2-pairing-tls.md](06-phase2-pairing-tls.md) | 实录 | 阶段 2：配对码 + 可选 TLS 的实施与验证 |
| [07-real-device-verification.md](07-real-device-verification.md) | 清单 | 真机验收：插件安装、Android/iOS 逐项用例、通过标准 |
| [08-web-mode.md](08-web-mode.md) | 实录 | Web 模式：代理直出启动页、浏览器零安装直连的实施与验证 |
| [09-web-security-hardening.md](09-web-security-hardening.md) | 实录 | Web 安全加固：设备会话、异常输入、同源校验与端到端回归 |
| [decisions/ADR-0001-docs-and-process.md](decisions/ADR-0001-docs-and-process.md) | ADR | 文档位置与过程记录方式 |
| [decisions/ADR-0002-architecture-remote-client.md](decisions/ADR-0002-architecture-remote-client.md) | ADR | 总体架构：远端客户端而非端上移植 |
| [decisions/ADR-0003-mobile-ui-out-of-tree-plugin.md](decisions/ADR-0003-mobile-ui-out-of-tree-plugin.md) | ADR | 移动 UI：树外客户端插件，不改上游源码 |
| [decisions/ADR-0004-token-proxy.md](decisions/ADR-0004-token-proxy.md) | ADR | 令牌反代暴露局域网，dsh 保持 loopback |
| [decisions/ADR-0005-ios-vendored-capacitor-spm.md](decisions/ADR-0005-ios-vendored-capacitor-spm.md) | ADR | iOS：vendor capacitor-swift-pm 实现离线构建 |
| [decisions/ADR-0006-pairing-code-and-tls.md](decisions/ADR-0006-pairing-code-and-tls.md) | ADR | 配对码兑换令牌；TLS 只做用户供证，不做自签自动信任 |
| [decisions/ADR-0007-web-mode-launcher.md](decisions/ADR-0007-web-mode-launcher.md) | ADR | Web 模式：代理直出启动页，浏览器零安装使用 |
| [decisions/ADR-0008-device-session-and-web-hardening.md](decisions/ADR-0008-device-session-and-web-hardening.md) | ADR | 主令牌降权为设备会话，并加固 Web 入口 |

## 工作约定

1. **每步一提交**：每个可独立说明的进展（一篇分析、一个决策、一个功能改动）单独提交，提交信息说明这一步做了什么、为什么。
2. **决策记录（ADR）**：凡是"有多种做法、选了其一"的地方，在 `decisions/` 下新增一份 ADR，按 `ADR-NNNN-标题.md` 编号，格式为：状态 / 背景 / 决策 / 后果（含被否决方案及否决理由）。已接受的 ADR 不改写，只能被新的 ADR 取代（Superseded by …）。
3. **分析文档可以修订**：`01`–`03` 这类现状分析随认知加深可以更新，但结论性判断一旦落地为 ADR，以 ADR 为准。
4. **下载优先国内源**：凡涉及外网下载（npm 包、Node 头文件、预编译二进制、Playwright 浏览器、pip 包、GitHub 大文件），默认先配置国内镜像再执行，具体配置见 `02-build-and-dependencies.md` 第 4 节。
5. **不参考 `~/dsh-desktop`**：那是并行推进的另一套实现，本项目独立分析与实施。
6. **事实要可复核**：文档中关于上游仓库的论断都标注对应文件路径；上游变化后应复查这些论断。
