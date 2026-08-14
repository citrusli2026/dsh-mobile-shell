# ADR-0005 iOS 依赖本地化：vendor capacitor-swift-pm 与本地 binaryTarget

- 状态：已接受（2026-08-14）
- 依据：阶段 1 PoC 构建实录（`.run/xcodebuild.log`）

## 背景

Capacitor 8 的 iOS 集成只走 SPM。其官方包 `ionic-team/capacitor-swift-pm` 是**二进制目标包**：git 仓库本身仅 240K，真正的 `Capacitor.xcframework.zip` / `Cordova.xcframework.zip`（合计约 28M）由 `Package.swift` 里的 `binaryTarget(url:)` 从 github.com Releases 下载。

本机网络实测：

- `git clone` 经 ghproxy 镜像 2.6 秒完成；但 xcodebuild 的 SPM 解析阶段（`waitForRemoteSourcePackagesToFinishLoading`）在 github.com 直连与镜像 URL 下均无限期挂起（0% CPU，无子进程活动），多次清理 DerivedData/SPM 缓存后仍复现。
- 两个 zip 经镜像 `https://ghproxy.net/https://github.com/...` 分别 18.8s / 3.9s 下载完成，且 sha256 与上游 `Package.swift` 声明的校验和逐字一致（`357220fe…`、`a3dc72b5…`）。

## 决策

1. 将 `capacitor-swift-pm` 8.5.0 浅克隆并去 `.git` 化，vendor 到 `app/ios/vendor/capacitor-swift-pm/`；两个官方 xcframework 校验和后解压进同一目录。
2. 改写其 `Package.swift`：`binaryTarget(url:)` → `binaryTarget(path:)` 本地目标；`CapApp-SPM/Package.swift` 的依赖从远程 URL 改为 `.package(path: "../../vendor/capacitor-swift-pm")`。构建全程零网络。
3. 升级 Capacitor 大版本时：重新浅克隆对应 tag、重新下载校验 xcframework、核对上游 `Package.swift` 的 target 列表是否变化，一起提交。

## 后果

- 优点：iOS 构建完全离线、可复现；与上游仓库自身 vendored Cordis 的哲学一致（可审计、可打补丁、钉版本）；后续 CI（GitHub Actions macos runner）也免受 GitHub Releases 抖动影响。
- 代价：仓库增大约 28M 二进制；升级需要手工四步（见上），已写入本文档。
- 被否决方案：
  - **保持远程 URL + 祈祷网络**：实测不可复现地挂起，否决。
  - **SPM 缓存预热（手工填 `org.swift.swiftpm/repositories`）**：缓存键含 URL 哈希，Xcode 内部 SourceControl 行为不透明，脆弱，否决。
  - **CocoaPods**：Capacitor 8 已全面转向 SPM，且 CocoaPods 自身已宣布进入维护终期，否决。
- 安全核验：vendor 内容的可信度由"zip 的 sha256 == 上游 Package.swift 声明值"保证；任何升级必须复验。

## 取代关系

无。若 Capacitor 未来提供 npm 内嵌 xcframework 或 SPM registry 镜像支持，应重估。

## 执行注记（2026-08-14 追加）

`cap sync ios` 会重新生成 `CapApp-SPM/Package.swift`（文件头声明 "DO NOT MODIFY"），把本地路径依赖静默还原为 github.com 远程 URL——本 ADR 的离线保证曾被该行为悄悄撤销（阶段 2 期间实测复现）。对策：`scripts/fix-spm-vendor.mjs` 幂等恢复本地声明，已接入 `npm run sync`（app/package.json）与 CI 的 cap sync 步骤之后。手工执行 `npx cap sync ios` 后必须补跑该脚本。
