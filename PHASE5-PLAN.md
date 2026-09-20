# Phase 5 计划：xiaobei-web 独立分发（独立可选程序，装不装都不影响小贝）

> 日期：2026-09-18。状态：**审核意见（§七 R1–R6）修订纳入（§八），实施完成（T2/T4/T5 已回归，2026-09-20）；T3 建仓/CI/首发待主理人决策**。
> 前置：Phase 4.5 已完成并过审（commit 3365f68，审核 §六 Q1–Q6 全落地）；本机 launchd 生产部署已运行（deploy/ + XIAOBEI-WEB-DEPLOY-LOG.md）。
> 定位变化：web 从「主理人自用、随仓库手工部署」升级为**独立可分发程序**——独立发布、独立安装/升级/卸载，与 xiaobei 引擎完全解耦，唯一耦合面 = gateway WS 地址 + 令牌（已实现，见 §2）。
> 与多租户 SaaS 的关系：SaaS 顺延不变；本阶段是「每台装 xiaobei 的机器可选获得一个本机控制台」，不引入任何多租户改造。远程访问（Tailscale/局域网）与本阶段正交，不并入。

## 0. 决策链

```
用户需求（2026-09-18）：其他人安装 xiaobei 后，也能安装这个 web 前端
  → 追加定夺：web 是独立程序，可装可不装——不捆绑进 xiaobei tarball/install.sh
  → 方案比选：
    A. 捆绑进 xiaobei tarball（否：违背"可装可不装"；引擎发版被 web 绑架）
    B. 独立分发链（采纳）：web 仓库自己出预构建 release + 自己的 install/update/uninstall 脚本，
       对齐 xiaobei 现有模式（预构建 tarball + 一键脚本 + 国内镜像专线）
  → Node 运行时依赖：小白机器可能没有 Node
    → 首选复用 ~/xiaobei/tools/node 的 portable node（web 本就依赖已装的 xiaobei 引擎）；
      兜底系统 node ≥ 20；两者都无 → 安装脚本给出明确指引
  → Windows：daemon 方案差异大 → 首版标注实验性
  → 构建形态：独立程序无法假设用户侧有构建环境 → 预构建 standalone 产物（CI 分平台出包），
    用户侧零构建零编译
```

## 1. 目标 / 非目标

**目标**
1. xiaobei-web 作为一个独立程序，任何人装好 xiaobei 后可用一条命令安装 web 控制台：`curl … install-web.sh | bash`。
2. 安装过程零手工配置：自动检测引擎与 gateway 令牌、自动生成本机 API 令牌、自动装常驻服务（自启 + 崩溃自拉）、打印访问地址与令牌。
3. 独立升级（`update-web.sh`）与干净卸载（`uninstall-web.sh`，不动 `~/.openclaw` 运行数据）。
4. macOS（arm64/x64）与 Linux（x64）为一等支持；Windows 实验性。

**非目标**
- 多租户 / 多用户 / 权限分级（SaaS 顺延，用户已定不做）
- 公网暴露方案（Tailscale/局域网远程访问正交，文档给指引即可）
- 捆绑进 xiaobei 引擎 tarball 或修改 xiaobei 的 install.sh（可选后续增强：引擎安装完成提示加一行"可选安装 web"，跨仓库改动，本阶段不做）
- 手机端适配、国际化（backlog）

## 2. 技术前提

**已证实（现有代码/部署，无需掘取）**：
- 耦合面已就绪：BFF 启动连 `OPENCLAW_GATEWAY_URL ?? ws://127.0.0.1:18789`，令牌读 `OPENCLAW_GATEWAY_TOKEN` → `~/.openclaw/openclaw.json` 的 `gateway.auth.token`（lib/gateway.ts）——安装脚本无需注入任何引擎配置。
- API 令牌机制：`api-auth.ts` 首次缺失自动生成并追加 `.env.local`（已用 CSPRNG）；浏览器粘贴一次即长期免粘。
- launchd 部署有可参照的 plist（deploy/ai.xiaobei.web.plist），但**现状是缺 RunAtLoad/KeepAlive 且路径全硬编码开发者本机**（2026-09-20 审核 §七 R1 指出；本机运行态 plist 已手工加固，但仓库模板未参数化）——补键 + 参数化是 T4 实打实工作项，非已证实起点。
- `serverExternalPackages: ["ws"]` 已处理生产打包（XIAOBEI-WEB-DEPLOY-LOG 记录的 ws 打包事故与修法）。
- xiaobei 引擎分发模式参照物：`~/xiaobei/scripts/install.sh`（预构建 tarball + portable node/pnpm + daemon install + atomgit 镜像专线），1830 行成熟实现。

**T1 待掘取（本阶段第一项任务，阻塞设计定稿）**：
1. **standalone 构建可行性**：✅ 已实测通过（见 §3.1 T1 结论，2026-09-20）——turbopack 兼容、无 monorepo 嵌套、ws 正确 trace、67M+1M。
2. **发布通道现状**：本仓库目前无 git remote——需新建远端仓库（GitHub；是否复刻 atomgit 镜像线待主理人定）+ release 流程。这是本阶段唯一需要主理人决策的基建项。
3. **平台矩阵**：mac-arm64 本机可实测；linux-x64 依赖 CI（docker）验证；win-x64 出包但不承诺。
4. **Node 运行时策略验证**：`~/xiaobei/tools/node` 的 portable node 版本是否满足 Next 15.5 要求（引擎锁 2026.7.1-2）。

## 3. 方案设计

### 3.1 构建形态（T1 已定稿：standalone，2026-09-20 实测）
**T1 实测结论（本机 mac-arm64，Next 15.5.25 + turbopack）**：
- `output: "standalone"` 与 `--turbopack` 构建一次通过，无冲突；
- **无 monorepo 路径嵌套**：`server.js` 直接位于 `.next/standalone/` 根（非 `.next/standalone/apps/web/`），分发包结构简单；
- `ws` 被 `serverExternalPackages` 正确 trace 进 `standalone/node_modules`（实测 standalone 起服后 bilibili 探活 200）；
- `react-markdown` 等其余依赖内联打进 server bundle（calibration 页 200 验证），不依赖 standalone/node_modules；
- 体积：standalone 67M + static 1M；启动 Ready 114ms；首页 / `/api/logins` / `/api/logins/probe` 冒烟全过。
- **分发包组装要点**：tarball = standalone 目录 + 把 `.next/static` 拷入 `standalone/.next/static` + `public/`（install 脚本负责或直接打进包内）。

→ 选型定为 standalone；备选方案（ship 源码+用户侧构建）废弃。
- 启动命令为 `node {安装目录}/server.js`——**standalone server.js 无 -H/-p 参数，读 `PORT`/`HOSTNAME` 环境变量，且 HOSTNAME 缺省为 0.0.0.0**（T1 补充实测）：daemon/wrapper 必须显式 `export HOSTNAME=127.0.0.1`（安全默认，远程访问由用户显式改）与 `PORT={端口}`。

### 3.2 发布物与 CI
- 新远端仓库 + GitHub Actions：tag push → 四平台构建（mac-arm64/mac-x64/linux-x64 用 CI 原生 runner，win-x64 实验性）→ `xiaobei-web-{ver}-{plat}.tar.gz` → GitHub Release（附 SHA256）。
- 国内镜像：atomgit 专线复刻 xiaobei 的双线模式（脚本内按镜像 flag 切下载源）。
- 版本：web 独立 semver（当前 0.1.0 起步）；与引擎的兼容承诺 = gateway 协议版本（BFF 握手 min/max protocol v4 已内置协商，引擎侧升级协议大版本时 web 需跟版）。

### 3.3 安装/升级/卸载脚本（scripts/ 新增）
- **install-web.sh**（对齐 xiaobei install.sh 的骨架与风格）：
  1. 检测 OS/arch → 选产物；
2. **前置检测**（§七 R4 放宽）：引擎可执行存在（`~/xiaobei/bin/openclaw` 或 PATH 中 `openclaw`）**或** `~/.openclaw/openclaw.json` 存在 → 通过；两者皆无 → 报"请先安装 xiaobei 引擎"并给出链接（web 可装可不装，但装了就必须有引擎，这是产品事实，诚实报错优于静默半装）；引擎在但 token 字段空 → 提示"请先启动一次引擎完成初始化"；
  3. 解压到 `~/xiaobei-web/`（程序目录；与运行数据分离，同 xiaobei 的目录哲学）；
  4. Node 解析：`~/xiaobei/tools/node` → 系统 node ≥ 20 → 明确报错；
  5. 生成 API 令牌（CSPRNG，**外置写 `~/.xiaobei-web/env.local`**——程序目录纯程序，升级零保留负担（§七 R2）；0600 权限；程序目录内不留令牌副本）；
  6. daemon 安装：macOS launchd（模板生成而非拷贝现成 plist——**补 RunAtLoad + KeepAlive；ProgramArguments 指向安装时生成的 `start-web.sh` wrapper（内部为安装时解析的 node 绝对路径 + `server.js` 绝对路径），WorkingDirectory/log 路径全部按实际安装位置生成（§七 R1）；端口参数化：install 检测 3000 被占时按 `--port` 参数或自动递增确定端口写入 `~/.xiaobei-web/env.local` 的 `XB_WEB_PORT`，wrapper `export PORT` 注入（§七 R3；standalone server.js 读 PORT/HOSTNAME env，无 -p）；wrapper 显式 `export HOSTNAME=127.0.0.1`**）；Linux systemd user unit（同语义）；
  7. 端口冲突检测（3000 被占 → `--port` 传入或自动递增，最终端口写入 env.local 并打印）；
  8. 打印访问指引：URL + 令牌 + "升级用 update-web.sh"。
- **update-web.sh**：拉新产物 → 停 daemon → 换程序目录（保留 .env.local）→ 起 daemon。
- **uninstall-web.sh**：停 + 卸 daemon → 删 `~/xiaobei-web/`（交互确认；绝不触碰 `~/.openclaw`）。

### 3.4 首次访问体验
- 弹窗令牌指引文案改造（lib/client/api.ts:33）：当前提示写死了本机仓库路径，改为通用文案（"令牌在安装时已打印，也可查看 ~/xiaobei-web 安装目录说明或 ~/.xiaobei-web/env.local 的 XB_WEB_TOKEN"）。
- 连接失败（引擎未启动）时聊天页已有黄点态，黄点旁补一行**可复制的引擎启动命令**（§七 R6，仅文案不引入逻辑）：如 `launchctl kickstart gui/$(id -u)/ai.openclaw.gateway`，新装用户省一次困惑。

## 4. 红线与安全（分发后必须守住的）

1. web 永远只监听 127.0.0.1 默认；改绑 0.0.0.0 必须是用户显式行为，README 写明风险（同一 API 令牌 = 同一权限）。
2. 令牌生成用 CSPRNG（对齐 F16 审核决议）；文件权限 0600；不出现在安装日志。
3. 安装/升级/卸载脚本对 `~/.openclaw` **零写入**（只读 openclaw.json 令牌），红线延续。
4. 产物校验：Release 附 SHA256，脚本下载后校验（对齐 xiaobei 模式）。
5. 全部安全既有结论不变：cookie 值零回显、模板零进前端、sales-cs 不可达、渠道会话不可经 web 访问。

## 5. 任务拆分

| 任务 | 内容 | 产出 |
|---|---|---|
| T1 | 掘取：standalone 构建实测（turbopack/ws/monorepo 三点）+ portable node 版本核对（审核员已核 v24.15.0 满足，降为确认项）+ linux 产物 CI 预演 | DEVELOPMENT-LOG 掘取节 + §3.1 定稿 |
| T2 | web 侧改造：next.config 加 `output: "standalone"`（按 T1 结论）、令牌文案通用化（api.ts:33 去 dev 路径）、黄点态引擎启动指引（R6） | 全链路 |
| T3 | 建远端仓库 + CI 四平台出包 + 首个 release（**需主理人建仓/授权**） | 发布物 v0.2.0 |
| T4 | install/update/uninstall 三脚本（mac 先行，linux CI 验证，win 出包不承诺）：plist 生成含 RunAtLoad+KeepAlive + 路径参数化（R1）、.env.local 外置 `~/.xiaobei-web/env.local`（R2）、端口参数化写入 daemon（R3）、前置检测放宽（R4） | scripts/ |
| T5 | 回归：本机干净目录模拟安装全流程 + 升级 + 卸载；无引擎报错路径；README 分发节（含 R5 信任假设说明） | DEVELOPMENT-LOG Phase 5 节 + 送审 |

依赖：T2←T1；T4←T1/T2；T5←T3/T4。T3 建仓是外部依赖，可与 T2/T4 并行准备。

## 6. 验收矩阵（T5 执行）

1. 干净目录安装 → 浏览器访问 → 粘令牌 → 聊天/指令/铃铛/logins 全功能可用；
2. 未装引擎时安装 → 明确报错指引，不产生半装状态（R4：引擎可执行在但未首跑 → 提示先启动引擎）；
3. 升级：`~/.xiaobei-web/env.local` 令牌保留（R2）、数据无损；
4. 卸载：程序目录删除、launchd 无残留、~/.openclaw 原样；
5. 重启机器 → web 自启（RunAtLoad）；kill 进程 → 自拉（KeepAlive）；断言生成的 plist 两键齐全且路径为实际安装位置（R1）；
6. 端口：3000 占用时 install 换端口且 daemon 监听该端口（R3，经 wrapper `export PORT` 生效）；
7. SHA256 校验 + 0600 令牌权限断言；
8. tsc + eslint 全绿。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| standalone 与 turbopack/ws 冲突 | T1 首项实测；备选 ship 源码+用户侧构建（§3.1） |
| 本仓库无远端、发布链从零建 | T3 提前并行；需主理人决策建仓位置与镜像线 |
| 引擎升级破坏协议兼容 | 握手已有 min/max 协商，BFF 报错可见；README 写兼容矩阵 |
| 用户机器 Node 缺失/过旧 | 复用引擎 portable node 为主路径；检测兜底 |
| Windows daemon 质量不可控 | 标注实验性，出包不承诺，问题单独跟进 |

## 8. 修订记录

审核：AUDIT-REPORT §七（2026-09-20，Claude），R1–R6 全部采纳，映射如下：

| 审核项 | 修订 |
|---|---|
| R1 [高] §2.3 launchd 现状误述（模板缺自启/自拉键 + 路径硬编码） | §2.3 改述为"可参照但未参数化"，从已证实挪为 T4 工作项；§3.3.6 明确 plist 生成补 RunAtLoad/KeepAlive + 路径按安装位置生成；§6.5 验收断言两键齐全 |
| R2 [中] .env.local 在程序目录内会被升级换掉 | §3.3.5 采纳方案 (a)：令牌外置 `~/.xiaobei-web/env.local`，程序目录纯程序；§6.3 验收相应更新 |
| R3 [中] 端口冲突闭环断在 daemon 侧 | §3.3.6/3.3.7：install 确定端口（`--port` 或自动递增）并写入生成的 plist `-p`；§6.6 验收 |
| R4 [中] 引擎装了未首跑会误报 | §3.3.2：检测放宽为"引擎可执行 或 openclaw.json"；token 空时提示先启动引擎；§6.2 验收 |
| R5 [低] curl\|bash 安装器信任假设 | T5 README 分发节注明（HTTPS 官方仓 + tarball SHA256；需逐字节核验先下载检视） |
| R6 [低] 黄点态缺引擎启动指引 | §3.4：黄点旁补可复制启动命令（仅文案） |
| T1.4 portable node | 审核员已核 v24.15.0 满足 Next 15.5，降为确认项 |
