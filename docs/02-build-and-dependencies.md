# 02 构建与依赖下载流程分析

分析对象：上游仓库的安装、构建、发布链路。目的：弄清"下载依赖"到底下载了什么、从哪下载、哪里会慢，以及移动版将新增哪些下载点。需求方约定：**凡下载过慢，优先切国内镜像源**，第 4 节给出可粘贴配置。

## 1. 环境要求

- Node `^22.19.0 || >=24.0.0`，pnpm `11.7.0`（根 `package.json` 的 `engines`/`packageManager`；本机实测 node v24.15.0 + pnpm 11.7.0 可用）。
- 纯 ESM 仓库（`"type": "module"`），TypeScript `^6.0.3`。
- 仓库根**没有 `.npmrc`**，默认走 npm 官方 registry——国内首次安装通常需要换源（见第 4 节）。

## 2. 安装与构建链路（谁下载什么）

### 2.1 `pnpm install`

- pnpm workspace 成员：`vendor/*`、`packages/*/*`、`native/landlock-run(+packages/*)`、`apps/*`、`website`、`examples`、`python/sdk-runtime`（`pnpm-workspace.yaml`）。
- 框架层不发包到 registry：vendored Cordis 系列被重命名到 `@deepseek-ai/*` 并本地链接（`linkWorkspacePackages: true` + `overrides` 指向 `link:vendor/...`），门禁 `verify-vendored-links` 保证 lockfile 里不会出现 registry 副本。→ **这部分无网络下载，也不依赖 GitHub**。
- `node-pty@1.1.0` 使用 `patchedDependencies` 打本地补丁（`patches/node-pty@1.1.0.patch`）。
- 生命周期脚本默认拒绝（pnpm `strictDepBuilds`），仅白名单放行：`esbuild`（平台二进制）、`lefthook`（git hooks）、`node-pty`（node-gyp 源码编译）、`koffi`（原生 FFI 预编译产物）、`@deepseek-ai/dsh-subprocess-local` 的 postinstall。
- 根 `postinstall` 运行 `scripts/install-lefthook.mjs` 装 git hooks。
- `minimumReleaseAgeExclude` 表明仓库启用了 pnpm 的"最小发布年龄"防供应链策略。

安装阶段的主要网络下载（按来源分）：

| 来源 | 内容 | 国内慢点风险 |
|---|---|---|
| npm registry | 全部普通依赖的 tarball（含 esbuild、koffi、node-addon-require-builtin、landlock-run 的平台可选包——平台二进制作为 npm optional deps 分发，换 registry 即可加速） | 中，换 registry 解决 |
| nodejs.org | `node-pty` node-gyp 编译时下载的 Node 头文件 | 高，需 `disturl` 镜像 |
| GitHub Releases | 少数工具的预编译产物（本仓库核心依赖大多走 npm 可选包，基本不涉及；`playwright` 浏览器从 CDN 下载且仅开发/测试用） | 中，仅测试链路 |

### 2.2 `pnpm run build`

纯本地编译，无网络下载（根 `package.json` scripts）：

1. `tsc -b tsconfig.host.json` + `tsdown --env.DSH_BUILD_FACE host`：tsc 项目引用产出 `lib/types`（声明与中间产物），tsdown 产出发布用运行时 bundle `lib/`（host 面）。
2. 同样流程跑 client 面（`tsconfig.client.json`）。仓库坚持"源码面 vs 产物面"分离：静态门禁走 tsconfig paths 到 `src`，发布路径走构建后的 `lib/`。
3. `vite build` 构建 `apps/web`（`@deepseek-ai/dsh-web-frontend`）产出 `dist/`，由 `dsh web` 静态伺服。

### 2.3 测试链路（仅开发者需要）

- `vitest` 单元测试无下载；`test:e2e` 需要 `DEEPSEEK_API_KEY` 访问真实 API。
- `playwright`（`apps/web` devDependency）首次使用下载浏览器二进制——这是本仓库最大的单一下载点，仅 GUI 测试需要。
- `mermaid`、`jsdom`、`@vitest/coverage-v8` 等均为普通 npm 包。

### 2.4 其他分发通道（与移动版并行存在）

- `python/sdk-runtime`：把运行时打成单可执行文件并捆绑 Python 运行时的部署根（独立构建链路）。
- `native/landlock-run`：Linux 沙箱启动器，按架构构建后以 npm 平台包发布。
- 发布：`scripts/release/*` 负责 bump/pack/publish，`@deepseek-ai/dsh` 家族已公开发布，终端用户 `npx @deepseek-ai/dsh web` 即用（根 `README.md`）。

## 3. 小结：上游下载面其实很小

框架 vendored、平台二进制全走 npm 可选包、构建零下载。真正可能卡的只有三处：**npm registry 本身**、**node-gyp 的 Node 头文件**、**Playwright 浏览器（仅测试）**。这三个都有成熟国内镜像。

## 4. 国内镜像配置（约定：下载前先配上）

### 4.1 npm/pnpm（`~/.npmrc`，用户级即可，不必提交上游）

```ini
registry=https://registry.npmmirror.com
# node-gyp 下载的 Node 头文件（node-pty 编译用）
disturl=https://npmmirror.com/mirrors/node
# Playwright 浏览器（仅跑 apps/web GUI 测试需要）
PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright
```

环境变量写法（CI/临时）：`npm_config_registry=https://registry.npmmirror.com`、`npm_config_disturl=https://npmmirror.com/mirrors/node`、`PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright`。

注意：换 registry 后 `pnpm-lock.yaml` 不变也能装（pnpm 按包名+版本从新 registry 取 tarball）；若遇到个别包校验问题，用 `pnpm install --registry=https://registry.npmmirror.com` 重装而非手改 lockfile。

### 4.2 pip（Python SDK 链路用到时）

```sh
pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
```

### 4.3 GitHub 访问

仓库克隆与 vendored 同步流程（`vendor/README.md`）涉及 GitHub；慢时优先用代理或 `https://mirror.ghproxy.com/` 类前缀加速，同步后按 `vendor/README.md` 流程重新应用本地修改并跑 `pnpm install && pnpm run test && pnpm run build`。

## 5. 移动版将新增的下载点（预判）

可行性结论落地后（见 `03-feasibility-analysis.md`），移动构建链路会新增以下下载，镜像方案一并列出：

| 下载点 | 默认来源 | 国内镜像方案 |
|---|---|---|
| Capacitor/壳工程 npm 依赖 | npm registry | `registry.npmmirror.com`（同 4.1） |
| Gradle 发行包 | services.gradle.org | 腾讯镜像 `https://mirrors.cloud.tencent.com/gradle/` 或阿里云镜像（`gradle-wrapper.properties` 的 `distributionUrl` 可改） |
| Android Gradle Plugin / Maven 依赖 | dl.google.com (google maven) | 阿里云 `https://maven.aliyun.com/repository/google`、`https://maven.aliyun.com/repository/central` |
| Android SDK 组件（cmdline-tools、platforms、build-tools） | dl.google.com | `sdkmanager` 走代理，或用腾讯/清华 AndroidSDK 镜像仓库（以镜像站当期可用性为准，接入前实测） |
| iOS：Xcode | Apple CDN | 国内直连通常可接受；CocoaPods specs 走清华镜像或 CDN+代理 |
| GitHub Actions 构建产物分发 | GitHub Releases | 发布时同时上传国内可访问的镜像（如 Gitee Release 或对象存储），方便"直接下载" |

Android 构建机建议直接配 `~/.gradle/init.gradle` 全局替换 google/mavenCentral 为阿里云镜像，避免改壳工程内文件。
