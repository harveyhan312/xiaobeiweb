# xiaobei-web 开发日志

> 用途：同步开发过程、关键决策与验证证据。代码审核（Claude）请先读本节背景，再按日期段读日志。
> 配套文档：`apps/web/docs/chat-protocol.md`（chat WS 协议固化）、`docs/` 下引用的 xiaobei 仓库文档。

---

## 项目背景（审核前必读）

### 小贝（xiaobei）是什么

xiaobei 是开源的自媒体获客 AI agent 产品（TeamWiseFlow/xiaobei，本机装 v5.7.0），底层是 openclaw 引擎（agent runtime，锁 commit 0790d9f5 / v2026.7.1-2，**非 fork，零侵入**）。小贝以微信 channel 为用户入口，背后是 crew 制 AI 团队：main（前台管家）、it-engineer（运维/配置）、content-producer（视频生产）、sales-cs（AI 客服）。已在本机安装并运行：程序 `~/xiaobei/`（portable Node 24 + pnpm，非全局 npm）、运行态 `~/.openclaw/`、gateway 是 launchd 服务 `ai.openclaw.gateway`，监听 `ws://127.0.0.1:18789`（loopback，token 鉴权，token 在 `~/.openclaw/openclaw.json` 的 `gateway.auth.token`，`OPENCLAW_SERVICE_MANAGED_ENV_KEYS` 声明管理 AWK_API_KEY/XIAOBEI_HOME）。

### 为什么要做这个项目

开源版 xiaobei **没有 web 前端**，交互全靠微信/飞书/企微 channel。本项目为小贝做 web 控制台（商业前端的起点，SaaS 终局），四个已完成的研究结论决定了架构：

1. openclaw gateway 本身是 HTTP+WS 服务器，暴露 `chat.send` / `chat.history` / `chat.abort` / `chat.inject` 等 RPC（token 鉴权）。**聊天直连 gateway，不写 channel 插件**。
2. dashboard 域数据不在 gateway API，全在 `~/.openclaw/` 的 sqlite + 文件（schema 已固化在实施计划 docs/2026-09-08_xiaobei-web-console-build-plan.md §4）。
3. **写操作（crew/channel/provider 配置）必须走 IT engineer 的 apply 脚本**（原子写回 + .bak + dry-run + 重启确认），web 永不直改 `openclaw.json`。
4. license：openclaw 自带 `web/` 控制台（LOGO 锁定 + 外观专利），本项目**从零做原创 UI**，不克隆其设计；多租户 SaaS（LICENSE:7）前必须获得 Team Wiseflow 书面授权——当前只做单租户私有部署形态。

### 架构决策

独立 Next.js 15 全栈 app（App Router + TS + Tailwind + shadcn/ui），**不是** channel 插件、不是纯前端：

- `apps/web/app/(chat)/` 聊天页 → WS 直连 gateway（`chat.send`，流式）
- `apps/web/app/(console)/` dashboard 页（只读 `~/.openclaw` 数据）
- `apps/web/app/api/` BFF：`/api/chat/proxy`（gateway token 不落前端）、`/api/data/*`（better-sqlite3 **readonly**）、`/api/config/*`（Phase 3，shell 调 IT apply 脚本）、`/api/health`
- 项目目录 `/Users/harvey/Documents/Qoder/projects/xiaobei-web/`，与 xiaobei 源码仓平级、独立 git；`~/xiaobei/` 保持只读不被污染

### 与运行中小贝的隔离承诺（审核时请重点核对）

1. web 进程独立（:3000），对 gateway 仅 WS 客户端，不占/不抢 18789，dev server 启停与 gateway 无关
2. Phase 1/2 对 `~/.openclaw` **零写入**（sqlite readonly 连接；json/jsonl 只读）
3. web 聊天用独立 sessionKey 前缀，不污染用户微信会话
4. `openclaw.json` 永不直改（Phase 3 也只经 IT apply 脚本）
5. 本机 8GB RAM：gateway 实测 ~110MB，dev server ~400MB，共存无压力；小贝做浏览器/视频重活时暂停 dev server

### 本机网络约束（影响依赖安装）

本机直连 GitHub 严重劣化（实测 HEAD 请求挂 5 分钟）。**npm 安装走 npmmirror；任何 GitHub 资源走 Clash 代理 `HTTPS_PROXY=http://127.0.0.1:7897`（Node fetch 需另加 `NODE_USE_ENV_PROXY=1`）**。百炼 API 直连不走代理。

### 坐标与现状快照（2026-09-12 开工时）

- xiaobei v5.7.0，gateway running（HTTP 200，10 插件），main agent 模型 deepseek-v4-flash-0731（百炼普通入口 `dashscope.aliyuncs.com/apps/anthropic`）
- `~/.openclaw/`：state/openclaw.sqlite（~100 表）、agents/{main,it-engineer}/sessions/*.jsonl、workspace-{main,it-engineer,content-producer,sales-cs}/（**注意：目录名是 workspace-main，不是计划文档写的 workspace/`**）
- 域数据库（published_track.db 等）**尚未创建**（还没有发布过内容）——Phase 2 页面初期为空态
- openclaw **TS 源码随 tarball 分发**：`~/xiaobei/openclaw/src/`（协议掘取以此为据，dist 编译物为辅）

---

## 日志

### 2026-09-12 · Phase 1 启动

**T1 · 掘取 chat.send WS 协议** ✅（2026-09-14 完成）

- 依据：`~/xiaobei/openclaw/packages/gateway-protocol/src/`（协议 schema 定义包）+ `packages/gateway-client/src/client.ts`（参考客户端）+ `src/gateway/server-methods/chat.ts`（handler）+ `src/gateway/server/ws-connection.ts`（挑战帧）——全部 TS 源码，逐行提取
- 产出：`apps/web/docs/chat-protocol.md`（12 节：传输鉴权/三步握手/帧封套/chat.* 全方法/流式事件四态/sessionKey/错误码/实现落点/安全红线）
- 关键发现（修正了计划文档 §3 的三处推定）：
  1. **token 不走 WS URL query，走 connect 帧的 `params.auth.token`**——握手是"服务器先发 `connect.challenge`（带 nonce）→ 客户端回 `connect` req（protocol 4/4 + auth）→ 服务器 res hello-ok"三步，hello-ok 里带 `features.methods`（运行时方法清单）、`policy`（payload/tick 上限）
  2. **幂等键字段名是 `idempotencyKey`（必填），不是"runId 参数"**——runId 是它在事件流里的名字；同 key 重发返回 `status:"in_flight"`，受理返回 `{runId, status:"started"}`
  3. **`chat.inject` 是 admin-only 且不对外广播**（core-descriptors.ts `advertise:false`）——计划文档"admin-only 消息注入"确认，本项目不用它
- 流式协议：广播事件名固定 `chat`，payload 四态（delta 带 deltaText/replace 追加重绘语义、final、aborted、error 五类 errorKind），run 内 seq 单调递增
- 越权边界：operator token 传 `originating*`/`systemInputProvenance`/`suppressCommandInterpretation` 直接 INVALID_REQUEST（admin 字段清单已写进协议文档 §4.1）

（以下随开发追加）

**T2 · Scaffold Next.js 项目 + 环境变量** ✅（2026-09-14 完成）

- 产物：`apps/web/`（create-next-app@15 模板：**next 15.5.25 / react 19.1.0 / TS / Tailwind v4 / ESLint 9 / Turbopack**，`pnpm dev` 冒烟测试 HTTP 200 已通过并停掉）
- 独立 git：`projects/xiaobei-web/` 已 `git init -b main`（**未做首次 commit**，留待审核后或用户指示）
- **踩坑记录（网络）**：`create-next-app` 一步式安装超时——pnpm 实际打到 registry.npmjs.org（`npm_config_registry` 环境变量对 pnpm 不生效），模板文件已生成但依赖失败。解法：模板落盘后删 `pnpm-lock.yaml`，`pnpm install --registry=https://registry.npmmirror.com` 重装成功（5m6s）。**经验：本机 pnpm 必须 `--registry` 旗标或项目 `.npmrc` 显式指定 npmmirror**（`.npmrc` 已随项目提交内容保留）
- 模板经临时目录 `web-tmp/` 脚手架后整体搬入 `apps/web/`（create-next-app 拒绝非空目录），package.json name 改 `xiaobei-web`
- `.env.local`：只放 `OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789`。**gateway token 不落项目目录**——BFF 运行时优先读 `OPENCLAW_GATEWAY_TOKEN` 环境变量，未设置则服务端从 `~/.openclaw/openclaw.json` 的 `gateway.auth.token` 解析（密钥始终不进 git、不进前端）
- 尚未做：shadcn/ui 初始化（Task #6 写聊天页前一并做）

**T3 · 聊天页 + BFF WS 桥** ✅（2026-09-14 完成，浏览器实测通过）

- **架构选型（偏离计划文档一处，原因如下）**：Next.js App Router 的 API route 无法挂 WS 服务端，浏览器⇄BFF 改用 **SSE（下行流）+ POST（发送/中止）**；BFF⇄gateway 用 `ws` 包按 `chat-protocol.md` 握手。对聊天场景 SSE 与 WS 等价（下行单工流 + 上行短请求），且省掉自定义 server 与 Turbopack 的兼容问题。**gateway token 仍只在 BFF 进程**
- 文件：`lib/gateway.ts`（连接单例：挑战→connect→hello-ok 握手、req/res 配对、chat 事件分发、tick 看门狗 90s、指数退避重连、dev HMR 下 globalThis 保单例）；`app/api/chat/{events,send,abort,history}/route.ts`；`app/page.tsx`（聊天 UI，纯 Tailwind）
- **token 解析**：`OPENCLAW_GATEWAY_TOKEN` 环境变量 → 未设置则读 `~/.openclaw/openclaw.json` 的 `gateway.auth.token`（服务端运行时解析，密钥零落项目目录）
- sessionKey：浏览器 localStorage 持久化 `web:<uuid>`；BFF 校验 `^web:[A-Za-z0-9-]{8,64}$` 才放行
- **实测踩坑（三个，都已修）**：
  1. **hello-ok 判定被 pending 查找短路**——握手的 connect 响应不走 pending 注册表（challenge 处理器直接 send），`if (!entry) return` 在 hello-ok 判定之前执行导致握手永不完成 → 判定提前
  2. **gateway 默认拒绝（default-deny）scope**——connect 不声明 `scopes` 就是零权限，`chat.send` 报 `missing scope: operator.write`；本机 backend+token 认证路径会保留所请求 scopes（`shouldSkipLocalBackendSelfPairing` 豁免），显式声明 `["operator.read","operator.write"]` 解决
  3. **事件里的 sessionKey 是规范化键**——gateway 把 `web:<uuid>` 规范化为 `agent:main:web:<uuid>`（sessions.json 实证），SSE 过滤器改为后缀匹配；历史消息 content 形状不统一（user=纯字符串，assistant=块数组），前端两种都处理
- **浏览器验证（chrome-devtools 驱动真实页面）**：三轮真实对话成功（含 800 字长文流式渲染）；刷新后历史恢复；`chat.abort` 契约实测 `{ok:true,aborted:false,runIds:[]}`。**局限**：deepseek-v4-flash 出字太快（数到 30 / 800 字短文均 3 秒内完稿），未能抓到"流式中途点停止"的时机，UI 停止按钮的中止-事件闭环未经真机流中验证（代码路径与 API 直测一致）
- **隔离验证**：`lsof -i:18789` 仍是 gateway（PID 1315 未变）；next dev RSS ~49MB；web 会话落在独立 sessionKey，微信侧无感知
- 去掉了 create-next-app 的 Geist Google 字体（本机网络会在 dev 启动时拖死字体下载），改系统字体栈

**T4 · BFF 数据层 + 引擎 dashboard 页** ✅（2026-09-14 完成，浏览器实测通过）

- **依赖选型（偏离计划文档一处，原因如下）**：计划文档定的 better-sqlite3 在本机有两个问题——原生模块需 node-gyp 编译或下载 GitHub prebuild（本机直连 GitHub 严重劣化）；改用 **Node 24 内置 `node:sqlite`（`DatabaseSync`）**，零依赖、`readOnly: true` 打开，API 与 better-sqlite3 同构（prepare/run/get/all）。`@types/node` 相应升到 ^22（node:sqlite 类型自 22 起内置）
- **简化说明（与计划文档 /api/data/* 的差异）**：dashboard 页用 **server component 直接在服务端读 `~/.openclaw`**（sqlite readonly / json 只读 / 目录扫描），浏览器拿到的只是渲染后的 HTML，等效于 BFF 只读接口的隔离性；省掉一层内部 HTTP 调用。`/api/data/*` 留到有客户端轮询/交互需求时再补
- 文件：`lib/xiaobei-data.ts`（只读数据层：openEngineDb / getTaskRuns / getFlowRuns / getCronJobs / getSessionsIndex / getMediaSummary / getConfigSummary + **stripSecrets**（键名 regex `/key|token|secret|password|credential/i` → "（已隐藏）"）+ formatMs 时区 Asia/Shanghai）；`app/(console)/layout.tsx`（导航：聊天/任务队列/会话/定时任务/媒体/配置总览）；`app/(console)/{tasks,sessions,cron,media,config}/page.tsx`，全部 `export const dynamic = "force-dynamic"`
- **隔离红线复述**：sqlite 连接一律 `readOnly: true`；json/jsonl 只读解析；`openclaw.json` 仅摘要展示且密钥剥离，**页面零写操作**（cron/media/config 页脚均注明"写操作走 agent 对话 / IT engineer apply 脚本"）
- **实测踩坑（一个）**：`getSessionsIndex` 起初把 `sessions.json` 里 `origin` 缺省的条目（heartbeat 等内部会话）当异常丢掉，改为容错展示"—"；其余各页一次通过
- **浏览器验证（chrome-devtools 实机截图）**：5 页全部 HTTP 200 + 渲染正确——`/tasks` 显示 wx-mp-hunter flow（succeeded）+ 3 条 it-engineer task_runs（agent 徽章、时间区间、可展开执行摘要）；`/sessions` 显示 4 条真实会话（含本 web 会话 `agent:main:web:…`，通道标注 webchat）；`/cron`、`/media` 空态正确（本机尚未创建 cron 任务、媒体目录——与开工快照一致）；`/config` 显示真实 agents（main/it-engineer/content-producer）、channel openclaw-weixin 启用、provider bailian-token-plan（dashscope anthropic 端点）、gateway loopback:18789 token 模式，**无任何密钥明文**

**T5 · Phase 1 端到端验收** ✅（2026-09-14）

- **聊天回归**：dev server 重启 + 5 个新页面上线后，聊天页历史自动恢复（localStorage sessionKey + chat.history 拉取），再发一轮真实对话，小贝流式回复"一切正常，我随时待命"——全链路（浏览器→SSE/POST→BFF→WS→gateway→main agent→流式回放）无回归
- **dashboard 验收**：5 页（tasks/sessions/cron/media/config）HTTP 200 + 真实数据/空态渲染正确（见 T4）
- **隔离终检**：`lsof -nP -i:18789` LISTEN 仍是 gateway（PID 1315，uptime 1 天+，全程未动）；11882 为 BFF 的出站 WS 连接（ESTABLISHED，client 发起方向）——web 进程从未监听/占用 gateway 端口；Phase 1/2 对 `~/.openclaw` 零写入（sqlite 全部 `readOnly:true`，json/jsonl 只读）
- **最终文件清单**（`apps/web/`）：`lib/gateway.ts`、`lib/xiaobei-data.ts`、`app/page.tsx`（聊天）、`app/api/chat/{events,send,abort,history}/route.ts`、`app/(console)/{layout,tasks,sessions,cron,media,config}`、`docs/chat-protocol.md`、`.env.local`（仅 URL）、`.npmrc`
- **git 状态**：仓库已 init（main 分支），**零 commit**——留给 Claude 代码审核后或用户指示再提交
- **遗留事项（审核关注点）**：① 停止按钮的中止-事件闭环未经真机流中验证（模型出字太快抓不到时机，API 契约已 curl 直测一致）；② `chat.inject` 为 admin-only，本项目按红线不使用；③ Phase 3 配置写操作尚未开始（走 IT engineer apply 脚本的方案在计划文档 §6）

---

## Phase 1 完成声明

计划文档 §8 验收项全部达成：聊天页直连 gateway 流式对话 ✅、任务队列/会话/定时任务/媒体/配置 5 个 dashboard 只读页 ✅、gateway 隔离 ✅、token 零泄漏 ✅。开发日志（本文件）与协议文档（`apps/web/docs/chat-protocol.md`）为审核入口。

---

## 2026-09-14 · 第三方审核（Claude）与修复

**审核结论**（报告全文：`AUDIT-REPORT.md`）：隔离红线 5 项全部通过（零写入/不占 18789/token 零泄漏/sessionKey 隔离/无越权字段与 chat.inject 引用）；功能层 10 项发现（F1–F10），无红线违规。以下为逐项处置。

**T6 · 审核修复** ✅（2026-09-14，tsc/eslint 双零 + 浏览器回归通过）

- **P0 F6（tsc 阻塞 next build）**：历史消息 `.map` 回调显式标注返回 `ChatMsg`，`role` 不再宽化为 `string`——`tsc --noEmit` 归零
- **P1 F3（stripSecrets 死代码）**：按报告建议①接线——`getConfigSummary` 解析后先整体过一遍 `stripSecrets` 再手挑字段，"手挑 + 全量剥离"双保险；`/config` 页实测渲染与修复前一致（手挑字段均不命中密钥 regex）
- **P1 F4（握手无超时 → SSE 永久挂起）**：`connect()` 内加 15s 握手超时——gateway 静默（不发 challenge / 不回 hello-ok）时 `terminate()` + reject，close 路径复用既有 `scheduleReconnect` 退避重连
- **P2 F2（幂等键每请求重生 → 重试产生重复 run）**：`idempotencyKey` 上移到浏览器 `crypto.randomUUID()` 生成、随请求体传入；BFF 校验格式（`^[A-Za-z0-9-]{8,64}$`）后透传；同一消息重试复用同 key → gateway `in_flight` 去重（协议 §4.3 正确语义）
- **P2 F5（ack 超时与已受理 run 的 UI 矛盾）**：发送失败（非 400/413 参数错）浏览器同 key 自动重试一次——已受理的 run 经 in_flight 去重拿回 runId、未受理的此刻真正开始，不再出现"标红失败却开始出字"；并补了重试等待期 run 已推流的边界（自建流消息与空占位合并，防 React key 冲突）。BFF 错误响应附带 gateway `code` 供浏览器判断
- **P3 F7（媒体计数含子目录）**：`readdirSync(dir, { withFileTypes: true })` 后 `.filter((e) => e.isFile()).length`
- **验证**：`tsc --noEmit` 0 error、`eslint .` 0 error/0 warning（审核基线 1 error + 1 warning 全清）；浏览器回归——聊天页历史恢复 + 新发送链路真实对话（"回归通过"）✅、`/config` 无回归 ✅、`/media` 200 ✅

**已知限制（审核确认，按报告建议记录在案）**：

- **F1 [中] BFF 无鉴权**：`/api/chat/*` 本机任意进程可调用。当前 dev server 只 bind localhost、单租户私有部署，风险可控；**Phase 3 配置写操作上线前必须补最小鉴权**（本地 token / loopback 校验 / 单用户口令，任选其一）
- **F8 [低] chat.history 无分页**：仅支持 limit≤1000，协议的 `hasMore`/`nextOffset` 未消费；单会话消息量临近 1000 时补 offset + "加载更多"
- **F9/F10 [信息]**：错误 message 原样回显、SSE 原样转发 payload——私有部署可接受，多租户化前统一错误出口 + payload 白名单

---

## 2026-09-14 · Phase 2（域 dashboard：业务数据只读视图）

**T7 · 域 schema 掘取 + `lib/xiaobei-domain.ts` 数据层** ✅（2026-09-14）

- **schema 来源（~/xiaobei/ 只读掘取）**：published-track `init-db.sh`（pub 表通用列 + distribute_status 语义 0/1/2）、expert-bd bd-record/info-record `init-db.sh`、expert-ir ir-record `init-db.sh`（状态机 new→contacted→bp_sent→meeting→dd→ts→invested/passed + contacts/applications）、sales-cs `db/schema.sql`（cs_record + follow_up，由 system hook 写入，web 永不写）、published-track SKILL.md（wx_channel 标题特殊处理、upsert 语义）、wx-mp 视频产线 SKILL.md（13 个里程碑 → 产物文件存在性推断）
- **新增 `apps/web/lib/xiaobei-domain.ts`**（~300 行，全部只读）：
  - `getDomainPlatforms()`：readdir workspace-main ∩ 16 平台白名单，hasDna/hasCalibration/hasOutputs 三布尔
  - `readWorkspaceTextFile(...parts)`：resolve 后强制前缀 `resolve(MAIN_WS)+sep`，**路径穿越守卫**（`..`/绝对路径注入无效）
  - `openDomainDb()`：existsSync 检查 + `readOnly:true`；**库文件不存在返回 null**（本机域库尚未创建，页面空态正确）
  - `getPublishedRows()`：sqlite_master 枚举 `pub_%` 表（正则 `/^pub_[a-z0-9_]+$/` 防注入），`SELECT *` 按发布日期倒序，互动指标 = 行数据减通用列后的数值列（**每平台指标列不同**，逐行动态拆分）
  - `getDnaIndex()`/`getCalibrations()`/`getBdData()`/`getIntelItems()`/`getIrData()`/`getCustomerData()`：对应库/目录只读聚合
  - `getVideoProjects()`：双来源扫描（content-producer/output_videos + wx_mp/outputs），13 里程碑映射为产物文件存在性；平台输出目录需命中 brief/artifacts/cover/finalDeliver 任一标记才纳入（草稿目录自动排除）
  - `OPENCLAW_STATE_DIR` 环境变量覆盖根路径——测试夹具可指向 /tmp，**不触碰 `~/.openclaw`**
- `lib/xiaobei-data.ts` 保持引擎域（Phase 1），域数据独立新文件，互不掺杂

**T8 · 6 个业务 dashboard 页 + 分组导航 + markdown 渲染** ✅（2026-09-14）

- **新增依赖**：`react-markdown@10.1.0` + `remark-gfm@4.0.1`（npmmirror，DNA 文档/复盘校准 md 渲染）
- **页面**（`app/(console)/`）：`publish`（发布记录总表：平台/标题/类型/日期/分发徽章/互动指标/DNA/账号/链接）、`dna` + `dna/[platform]/[dnaId]`（DNA 卡片索引 + 文档详情，segment id 正则守卫，notFound 兜底）、`calibration`（平台状态机 + 可折叠 md 文档）、`bd-ir`（5 区块：达人库/评论触达/情报库/投资人表/申请清单，7 天截止红色高亮）、`customers`（客户状态 + 跟进卡片）、`videos`（项目卡 + 里程碑清单 ✓/未完成删除线）
- **导航重构**：layout 分三组（业务 6 项 / 引擎 5 项 / 聊天），分组间分隔符
- **markdown 组件**：`(console)/_components/markdown.tsx`，ReactMarkdown + remarkGfm，arbitrary-variant 排版样式（h2/table/code 均衡），无外部 CSS
- **空态优先设计**：本机域库均未创建（从未发布过内容），6 页全部空态可用 + 文案说明"数据来源与写入方"，首批真实数据出现时零改动生效

**T9 · 验证 + 日志 + 提交** ✅（2026-09-14）

- **静态检查**：`tsc --noEmit` 0 error、`eslint .` 0 error/0 warning
- **夹具验证（不触碰 `~/.openclaw`）**：`/tmp/xb-fixture` 按真实 `init-db.sh` schema 1:1 建库（pub_wx_mp + pub_xhs 3 行真实感数据 + 视频目录两真一假），`node run-check.ts` 直接 import 真实 lib 断言通过——getPublishedRows 每平台指标拆分/日期倒序/分发标签、getVideoProjects 里程碑推断 + 草稿目录排除、缺库 null 容错
- **临时 dev server 视觉验证**：`OPENCLAW_STATE_DIR=/tmp/xb-fixture pnpm dev -p 3002`（:3001 被无关进程占用未动）——`/publish` 夹具数据渲染正确（分发徽章 已分发/无需分发/待分发、per-platform 指标、DNA/账号/链接列），`/videos` 两卡片里程碑推断正确（topic-a：简报/脚本/闸门A ✓；my-video：简报/片段 ✓；draft-article 未误入）。验证后进程已停、/tmp 夹具已删
- **真实数据视觉验证（:3000）**：`/dna` 2 张 DNA 卡（wx_mp + xhs）、`/dna/wx_mp/dna-0` markdown 全文渲染正常、`/calibration` 4 平台卡片（schema v + 可折叠文档）、`/publish` `/bd-ir` `/customers` `/videos` 空态 HTTP 200 文案正确
- **聊天回归**：react-markdown 安装后真实对话一轮（"ping，web 控制台回归测试"→ 流式回复"ok"），全链路无回归
- **隔离终检**：全程 `~/.openclaw` 零写入（域库/文件全部只读打开；夹具验证走 OPENCLAW_STATE_DIR=/tmp）；gateway 18789 未受影响；临时 dev server 用 :3002 且已停
- **git**：本次 Phase 2 变更随首个 commit 入库（见下方提交记录）

**Phase 2 已知限制**：

- 域库本机尚未创建——`getPublishedRows` 等的聚合口径（如每平台指标列名）基于 init-db.sh schema 推导，首批真实数据落库后需实际核对一次列名拼写
- follow_up `next_action_at` 截止高亮仅显示日期，无倒计时；BD/IR 数据当前为空，真实数据出现后需复核渲染密度
- `/bd-ir`、`/customers` 页脚已注明"web 只读，写入走 agent"——与 published-track/sales-cs hook 写入方约束一致

## Phase 2 完成声明

计划文档 §7 Phase 2 验收项达成：业务 6 页只读 dashboard ✅（发布记录/内容 DNA/复盘校准/BD·IR/客户库/视频生产）、引擎 5 页（Phase 1）✅、聊天直连 ✅、夹具 + 真实数据双重验证 ✅、隔离红线全程无违例 ✅。
