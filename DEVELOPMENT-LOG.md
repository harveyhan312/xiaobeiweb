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

---

## 2026-09-14 · Phase 2 复核修复（审核员 F11–F14）

审核员 Phase 2 复核结论：红线全绿、可继续推进；4 条发现（F11–F14，均低/信息级）。处置如下（tsc/eslint 双零）。

**T10 · 复核修复** ✅（2026-09-14）

- **F11 gateB 里程碑不渲染**：`VIDEO_MILESTONE_LABELS` 在 gateA 后补 `["gateB", "闸门B"]`（13 项齐）；顺带把 `/videos` 空态文案的硬编码阶段数改为动态 `VIDEO_MILESTONE_LABELS.length`（同源防漂移）
- **F12 多表查询容错粒度**：新增 `queryTable()`——先查 `sqlite_master` 探测表存在（参数化查询）再取数、逐表 try/catch；`getBdData`/`getIrData`/`getCustomerData` 六处双表查询全部改走该入口，单表缺失不再连带丢另一表数据
- **F13 外链协议白名单**：新增 `lib/safeUrl()`（仅放行 `^https?:`，trim 后判定）；接线在**数据层出口**而非逐个 href——`publishUrl`/`homepageUrl`/`postUrl` 进类型前即过滤，非法值置 null，对应 `LeadCreator.homepageUrl`/`CommentPost.postUrl` 类型收紧为 `string | null`，bd-ir 页两处 `<a>` 改条件渲染（publish 页原本就按 null 条件渲染，零改动）
- **F14 路径守卫不解析 symlink**：按审核意见**不修，记录在案**——当前威胁模型安全（workspace 由 agent 控制、web 零写入、入参正则校验）；未来 workspace 接受外部输入时改 `realpath` 校验
- **验证**：tsc 0 error、eslint 0/0；/tmp 部分表夹具（只有 lead_creators 无 comment_posts）经 node 实测——lead 数据保留、缺表返回空数组不崩溃；safeUrl 7 组用例全过（https 放行含 trim、javascript:/data:/相对路径/空/null 均置 null）；:3000 八页全 200，`/videos` 空态动态显示 13 阶段

---

## 2026-09-14 · Phase 3 P3-A：BFF 最小鉴权（审核 F1 前置项）

审核 F1 指出：/api 路由无任何鉴权，LAN 内任意设备可调用 chat.send 操纵 agent。P3-A 落地三层防线（tsc/eslint 双零）。

**设计决策（含一次实证修正）**：

- **初案否决**：原计划用 `X-Forwarded-For` 判定客户端是否环回——实测 `curl -H "X-Forwarded-For: 8.8.8.8" http://127.0.0.1:3000/...` 该头原样透传进 route handler，**客户端可任意伪造**，不能作为信任边界。降级为纵深防御信号。
- **三层防线**（真正的边界是前两层）：
  1. **OS 层**：`package.json` dev/start 脚本加 `-H 127.0.0.1`，server 只绑环回接口，LAN 设备 TCP 连接直接被拒（OS 级，无代码可绕）；
  2. **共享令牌**：全部 /api 路由要求 `x-xb-token` 头或 `xb_token` cookie（后者为 EventSource 无法带自定义头的替代通道），常时比较（`timingSafeEqual(sha256(a), sha256(b))` 防时序侧信道）；令牌来源 `env XB_WEB_TOKEN` → `.env.local`（首次缺失自动生成 base64url 43 位并追加，gitignored）；浏览器侧 `lib/client/api.ts` 的 `apiFetch` 自动带头，401 `NEEDS_TOKEN` 时弹原生 prompt 引导粘贴一次，存 localStorage 并镜像 cookie；
  3. **XFF 纵深**：非环回 XFF 首跳直接 403 `FORBIDDEN_REMOTE`（可被伪造绕过，故仅作哨兵）。

**改动清单**：

- 新增 `lib/api-auth.ts`：`checkApiAuth`/`authDeniedResponse`/`resolveApiToken`（自动 provisioning + 进程内 memoize；向既有文件追加后 best-effort `chmod 0600`——`appendFileSync` 的 mode 仅新建时生效）
- 新增 `lib/client/api.ts`：`apiFetch`（自动令牌 + 401 引导重试）、`storeToken`（localStorage + cookie 镜像）
- 4 个 chat 路由（send/history/abort/events）handler 顶部统一接线守卫
- `app/page.tsx` 三处 fetch（history/send/abort）改走 `apiFetch`；EventSource URL 不变（走镜像 cookie）；其余 console 页为 server component 直读域库，不经 /api，无需改动
- `package.json`：`dev`/`start` 加 `-H 127.0.0.1`
- `.env.local` 实际权限收紧为 `0600`（验证 `stat` 确认）

**验证证据**（curl 鉴权矩阵 + 浏览器实测）：

| 用例 | 结果 |
|------|------|
| 无令牌 → /api/chat/history | 401 `NEEDS_TOKEN` ✅ |
| 错误令牌 | 401 `NEEDS_TOKEN` ✅ |
| 正确令牌（header） | 200 `{"messages":[]}` ✅ |
| 正确令牌（cookie，EventSource 通道） | 200 ✅ |
| 正确令牌 + 伪造 XFF 8.8.8.8 | 403 `FORBIDDEN_REMOTE` ✅ |
| LAN 接口 `http://10.2.112.68:3000`（en0 IP） | connection refused（exit 7）——绑定生效 ✅ |
| 浏览器：清除令牌后访问 / | history/events 均 401（守卫真实拦截浏览器请求）✅ |
| 浏览器：按 storeToken 等效路径写入 localStorage+cookie 后刷新 | history 200、SSE 认证通过连接点变绿（bg-green-500）✅ |

- 静态检查：`tsc --noEmit` 0 error（修复 `AuthFailure.status` 漏 500、`Response.json` 静态方法在当前 lib 下不可用两处类型错误）、`eslint` 0/0

**已知限制**：

- 首次冷启动时序：dev server 首个 API 请求触发令牌生成并追加 `.env.local`，随后日志打印落点提示；若`.env.local` 只读则退化为进程内令牌（重启即换，浏览器需重新粘贴），日志已注明
- 原生 prompt 对话框在浏览器自动化中被框架自动关闭，未能自动化模拟"粘贴令牌"本身；已用等效路径（写入 localStorage+cookie）验证 storeToken 之后的全链路，prompt→store→retry 代码路径简单直接，首次真实使用时人工确认即可
- 令牌为单用户共享凭据（本机单人场景足够）；未来多用户需升级为 per-user 会话
- -H 绑定只在通过 `pnpm dev`/`pnpm start` 启动时生效（自定义启动方式需自行带上参数）

---

## 2026-09-14 · Phase 3 P3-C：低风险域数据写回 API + UI

计划文档 §5 指定走 agent 侧已封装的具名子命令（published-track / ir-record / customer-db 脚本），不直改库。落点：业务 3 页从只读升级为"低风险写回"（tsc/eslint 双零）。

**安全设计（脚本信任边界分析）**：

- 逐行核对三个脚本源码：**脚本对 `--id`/`--platform` 不做整数/枚举校验即拼 SQL**（如 set-distribute-status.sh `WHERE id = $ID`），值仅做单引号转义。因此 BFF 必须白名单化全部入参，不能透传
- **执行方式**：`execFile("bash", [script, ...args])` 参数数组、无 shell，杜绝参数注入；timeout 15s、maxBuffer 1MB
- **双重校验**：API 路由层做白名单（返回干净 400），`lib/xiaobei-write.ts` 写回层对整数/枚举/字符集再复检一次（`rejected:` 前缀 → 400）
- **收敛写面**：BFF 只开放**按 id 单行写**；脚本的 `--source-folder` 批量写与 `--mark-all-distributed` 全平台批量不开放给 web（误伤面大，仍留给 agent）；指标补录仅接受非负整数、≤8 列/次；IR 备注限 500 字且禁控制字符；cal_* 校准列不开放（content-calibrator 职责）

**脚本定位约定**：脚本以自身路径推导 workspace ROOT（不读环境变量），写回层按读层同一约定用 `OPENCLAW_STATE_DIR` 解析脚本绝对路径——生产默认 `~/.openclaw`，sandbox 测试指向夹具树即可整体切换，与读层（xiaobei-domain）天然一致。

**改动清单**：

- 新增 `lib/xiaobei-write.ts`：5 个写函数（setDistributeStatus/updateMetrics/updateIrStatus/completeFollowUp/cancelPendingFollowUps）+ IR 状态机枚举导出（new→contacted→bp_sent→meeting→dd→ts→invested，任意阶段可 passed，与 expert-ir SKILL.md 一致）
- 新增 `lib/api-script.ts`：脚本 JSON/纯文本输出统一映射（ok→200 含脚本回执；rejected→400；脚本失败→502 透传脚本错误信息）
- 新增 4 个写路由（全部挂 P3-A 鉴权守卫）：`/api/domain/publish/distribute-status`、`/api/domain/publish/metrics`、`/api/domain/ir/status`、`/api/domain/customers/followup`（action: complete/cancel）
- 读层增强：`PublishedRow` 补 `id`（写操作按行定位的前提）、`getMetricColumns()` PRAGMA 实时枚举指标列（排除公共列/cal_*/updated_at）、`PLATFORM_SET` 导出
- 新增 `app/(console)/_components/domain-write.tsx`：4 个客户端组件（DistributeControl 分发下拉 / MetricsForm 指标补录 / IrStatusControl 状态+备注 / FollowUpActions 完成与取消），经 `postDomainJson`（带令牌）成功后 `router.refresh()`
- 页面接线：/publish 加操作列、/bd-ir IR 状态单元格改控件、/customers 跟进卡加按钮；三页页脚"只读/不提供写操作"措辞同步更新

**验证证据（sandbox 夹具，`OPENCLAW_STATE_DIR=/tmp/xb-write-fixture`）**：

夹具 = 真实脚本树拷贝 + 各自 init-db.sh 建库 + 播种行；验证全程真实 `~/.openclaw` 零写入（终检 workspace-main/db 仍不存在）。

| 用例 | 结果 |
|------|------|
| 分发状态 →2 | 200 `{ok:true,action:"updated",distribute_status:2}`，库中落库 ✅ |
| 指标补录 views=1000 likes=120 | 200 `updated_columns:2`，库中 1000/120 ✅ |
| 注入 id `"1 OR 1=1"` | 400（路由整数白名单拦截，未达脚本）✅ |
| 注入 platform `"xhs; DROP TABLE…"` | 400（平台枚举拦截）✅ |
| 注入指标列 `"views; DROP TABLE…--"` | 400（写回层列名白名单拦截）✅ |
| IR 状态 →meeting + 备注 | 200 `{ok:true}`，库中 status/notes 落库 ✅ |
| IR 非法状态 `"hacked"` | 400（状态机枚举拦截）✅ |
| 跟进 complete id=1 | 200，库中 status=completed、completed_at 置值 ✅ |
| 跟进 cancel by peer | 200 ✅ |
| 无令牌调用写 API | 401 ✅ |
| 浏览器 UI：/publish 夹具行渲染（下拉=已分发、指标 1000/120、补录按钮） | ✅ |
| 浏览器 UI：IR 下拉实际改为 contacted | UI→API→脚本→DB 全链路落库 ✅ |
| 浏览器 UI：/customers 跟进按钮渲染 | ✅ |
| :3000 正式 server 空态回归 | 无报错、空态正常 ✅ |

**已知限制**：

- 三个域库本机均未创建（与 Phase 2 结论一致）——写 API 在真实库出现前会透传脚本错误（"database not initialized"），UI 显示红字报错；agent 首次建库后零改动生效
- 指标补录仅开放数值列；文本型指标列（如 top_comment/notes）未开放
- customer-db 脚本输出为纯文本 emoji 行（非 JSON），BFF 映射为 `{ok:true,message}`——若未来脚本改 JSON 输出无需改 BFF
- follow-up complete 的回执文本留空时记为"web 控制台标记完成"（区分于 agent 真实发送的回执）

## 2026-09-14 · Phase 3 P3-B（补录）：CLI/gateway 接口掘取结论

P3-B 的产出直接支撑了 P3-C（写回走脚本）与 P3-D（写回走 config.patch RPC）的选型，此前未成节，此处补录供审核复核。

**掘取路径**：引擎安装在 `/Users/harvey/xiaobei/openclaw/`（非本仓），读 `src/gateway/server-methods/config.ts`、`src/gateway/methods/core-descriptors.ts`、`packages/gateway-protocol/src/schema/config.ts`、`src/config/merge-patch.ts`，以及 crews/it-engineer 下两个 channel sample（awada-channel-setup、work-channel-binding）。

**Method→scope 表（core-descriptors.ts，与本工程相关的部分）**：

| method | scope |
|--------|-------|
| config.get / gateway.restart.preflight / cron.list 等 | operator.read |
| chat.send | operator.write |
| config.patch / config.apply / cron.add / agents.create 等 | operator.admin |
| chat.inject | operator.admin（admin-only 注入，本工程不使用） |

**config.patch 参数**（ConfigPatchParamsSchema）：`{raw: string(JSON5 部分配置), baseHash?, replacePaths?: string[](≤256), note?, restartDelayMs?}`；响应 `{ok, path, config(打码), restart, sentinel}`。config.get 响应含 `hash`（即 baseHash）与 `resolved`（磁盘 authored 值，未掺运行时默认——patch 合并基准，避免运行时默认泄漏进写盘配置）。

**选型结论（架构 deviation，审核重点）**：

1. **域数据写回（P3-C）走 agent 侧脚本**（execFile 白名单），不走 gateway——域库（customer.db 等）是 agent 工作区文件，不在 openclaw.json 配置面内，gateway 无对应 RPC。
2. **channel 绑定写回（P3-D）走 gateway config.patch RPC**，不走 it-engineer apply 脚本——apply 脚本是给 agent 在聊天流里用的（依赖交互式确认），BFF 无法复用其确认流；config.patch 是 gateway 原生控制面，自带 schema 校验、密钥还原（restoreRedactedValues）、baseHash 乐观并发、破坏性数组补丁意图确认（replacePaths）、.bak 轮转与重启计划计算，护栏强于自研脚本封装。
3. **channel 铁律沿用**（it-engineer/AGENTS.md:92）：patch 只写 `bindings[].match.channel` + `channels.<name>` + `plugins.entries.<name>` 三处，模板即唯一写面。

## 2026-09-14 · Phase 3 P3-D：channel 绑定 GUI（dry-run→确认→apply→重启提示）

**设计**：

- **模板即唯一写面**（`lib/config-templates.ts`）：BFF 只接受 `kind + 凭证` 参数（awada: awadaKey；feishu: 1-8 组 accountId/appId/appSecret），patch fragment 全由服务端模板生成，浏览器不可能上送任意配置片段。awada 模板与 `awada-channel-setup/openclaw-awada-sample.json` 一致（channels.awada + plugins.load.paths 追加 + entries.awada.customerdb 指向 sales-cs workspace）；feishu 模板与 `work-channel-binding/samples/feishu-openclaw.json` 一致（bindings 过滤现有 feishu 路由后追加 + channels.feishu.accounts + entries.feishu.enabled）。
- **预览/apply 分离**（`lib/config-rpc.ts`）：preview 用 fresh `config.get` 取 baseHash + 当前切片 → 返回打码 patch（`maskChannelPatchSecrets`：awadaKey/appSecret→`****`）+ summary + replacePaths；apply 再取 fresh baseHash 后发 `config.patch`（乐观并发由 gateway 二次把关）。
- **权限面**：gateway connect scopes 增补 `operator.admin`（`lib/gateway.ts:200`）；4 个 `/api/config/*` 路由全部挂 `checkApiAuth`（写类 POST 同时受 OS loopback + 令牌双防线）。
- **页面**（`app/(console)/_components/channel-bind-panel.tsx`）：/config 页新增 ChannelBindPanel——kind 选择 → 凭证表单 → 预览（打码 JSON + summary + replacePaths + baseHash 前缀）→ 确认写回（绿色成功块 + restart/sentinel JSON + .bak 提示）→ 手动重启按钮（preflight + request 回显）。

**掘取发现的引擎语义（实现据此修正）**：

1. **响应 vs 自动重启竞态**：channel 变更触发 gateway 自动重启（SIGUSR1 in-process），重启可能先于响应送达掐断 WS——实测首跑 apply 文件已写、.bak 已生成但 BFF 侧超时（gateway log：`config.patch write` → `received SIGUSR1` → `res ✓ config.patch` 顺序不定）。兜底：apply 失败后以 3s/6s/9s 退避重取 `config.get`，若目标 channel 已启用且 hash 变化则判成功并附 note（`fetchSnapshotWithRetry`）；`gateway.restart.request`（delayMs=0）同理。
2. **replacePaths 只对数组生效**（`merge-patch.ts:104` 仅在 Array 分支检查）：`channels.feishu.accounts` 是普通对象走 merge，旧账号不会自动清除。修正：模板把"当前有、本次未提交"的账号补成 `null`（merge-patch 的 null 删键语义），实测残留 it-bot 被正确清除。
3. **null 删账号连带移除其 allowFrom 数组，触发破坏性补丁护栏**（`would remove entries from array path(s): channels.feishu.accounts.it-bot.allowFrom`）：修正：对每个被移除账号显式声明 `replacePaths: ["bindings", "channels.feishu.accounts.<id>.allowFrom"]`（账号结构由模板定义，allowFrom 是其中唯一数组）。bindings 为 id-keyed 数组、整体替换本就需声明。
4. **bindings-only 变更 `requiresRestart:false`**（sentinel 实证），credentials 变更才需重启——UI 重启提示按 gateway 返回的 restart 计划呈现而非写死。

**改动清单**：`lib/config-templates.ts`（新增）、`lib/config-rpc.ts`（新增）、`app/api/config/gateway/route.ts`（GET 快照切片）、`app/api/config/channel/preview/route.ts`、`app/api/config/channel/apply/route.ts`、`app/api/config/gateway/restart/route.ts`（新增）、`app/(console)/_components/channel-bind-panel.tsx`（新增）、`app/(console)/config/page.tsx`（接线 + 页脚措辞更新）、`lib/api-auth.ts`（加 jsonResponse helper，因当前 lib 无 Response.json 静态方法）、`lib/gateway.ts`（scopes）。

**验证证据（throwaway sandbox gateway）**：

sandbox = `/tmp/xb-p3d-sandbox/openclaw.json`（真实配置拷贝后剥离：bind=loopback、port=18795、独立 token、channels/plugins 全 disabled、AWK_API_KEY 用假占位注入进程环境）；:3004 dev server 以 `OPENCLAW_GATEWAY_URL/OPENCLAW_GATEWAY_TOKEN/OPENCLAW_STATE_DIR/XB_WEB_TOKEN` 指向 sandbox；真实 gateway(:18789/:3000) 全程只读。

| 用例 | 结果 |
|------|------|
| GET /api/config/gateway（sandbox） | hash/valid/bindings/pluginLoadPaths/channels 切片正确 ✅ |
| preview awada | patchMasked awadaKey=`****`、paths 去重追加、summary 3 条、baseHash 正确 ✅ |
| apply awada（响应跑赢重启时序） | 200 `{ok:true,sentinel:{persisted:true,…}}`；文件落盘、.bak 生成 ✅ |
| apply awada（重启掐断响应时序） | 文件已写 + .bak 已生成，退避复核后返回 `{ok:true,note:"…复核写盘成功…"}` ✅ |
| preview feishu 2 账号 | appSecret 全 `****`、bindings 保留 openclaw-weixin ✅ |
| apply feishu 后再 apply 少一个账号 | 残留账号被 null 删键清除（file 仅剩 main-bot）✅（修正前残留，修正后通过） |
| apply 缺 allowFrom 意图声明 | 400 透传 gateway 报错（修正前）；声明后 200（修正后）✅ |
| 浏览器 UI：kind=feishu → 填 2 账号 → 预览（打码回显）→ 确认写回 → 成功块 + sentinel JSON | 全链路 ✅ |
| 浏览器 UI：手动重启按钮 | preflight `{safe:true,blockers:[]}` + accepted 回显 ✅ |
| .bak 轮转 | openclaw.json.bak/.bak.1~.bak.4 多级轮转生效 ✅ |
| 无/错令牌（GET 与 3 个 POST 均测） | 401 ✅ |
| bad kind / 短 awadaKey / 非法 accountId | 400，错误消息明确 ✅ |
| 真实 gateway 只读冒烟（:3000 GET /api/config/gateway） | hash 5b0be2f6…、channels=[openclaw-weixin]、bindings 1 条，与 sandbox 隔离可辨 ✅ |
| tsc --noEmit / next lint | 0 错误 ✅ |

**已知限制**：

- apply 成功块的 restart 计划在"响应被重启截断"的时序下不可用（note 已注明），用户可从 /config 只读卡片与 gateway 日志确认实际状态
- screenshots 自动化抓取失败（chrome-devtools take_screenshot 持续 -32603），UI 证据以 DOM 断言文本为准
- feishu 账号除 allowFrom 外若存在模板外的数组字段（当前 schema 无），移除账号时 gateway 护栏将报 400 并透出具体路径——报错即修复路径，未做静默兜底
- real gateway 的写操作未在真实配置上演练（按约定真实 `~/.openclaw` 零写入；首次真实绑定建议先 preview 打码回显人工确认）

## 2026-09-14 · Phase 3 P3-E：crew 启停 + provider 凭证轮换 + agent 模型 + cron 运维

**掘取结论（影响实现选型）**：

1. **AgentEntrySchema 无 enabled/disabled 字段且 `.strict()`**（`src/config/zod-schema.agent-runtime.ts:1033`）——"启停"不是条目上的开关。产品语义（`docs/sales-cs-bootstrap.md` 停用流程、`crews/main/AGENTS.md` crew 管理）：**启用 = workspace sample（`~/.openclaw/workspace-<id>/openclaw_setting_sample.json`，占位符 `{path_to_.openclaw}`）并入 `agents.list`；停用 = 移除 entry，workspace 与数据保留**。
2. **计划文档里的 `agents.defaults.modelPolicy.allow` 在 v2026.7.1 schema 中不存在**——agent 模型分配改走引擎原生 `agents.update` RPC（`{agentId, model}`），deviation 记录于此。
3. **cron 计划设想 MCP 桥接**，实际 gateway 有原生 `cron.*` RPC（scope 同 P3-B 表），BFF 直连 WS 即可，无需 MCP 层——deviation 记录于此。`enabled` 是 job 顶层字段（`CronCommonOptionalFields`）；`state` 是调度器维护的运行态不可写（实测 `cron.update {patch:{state:…}}` 不成立，已改顶层 patch）。

**实现**：

- **crew 启停**（`lib/crew-rpc.ts`）：扫描状态目录下 `workspace-*/openclaw_setting_sample.json` 生成可用列表；启用 = 渲染 sample 后 `config.patch {agents:{list:[entry]}}`（id-keyed 数组按 id 合并，纯新增无需 replacePaths）；停用 = agents.list 滤除后整体替换（`replacePaths:["agents.list"]` 显式声明）。护栏：`main`/`it-engineer` 受保护不可停用（it-engineer 生命周期不受 crew 管理）；停用前扫描配置引用（`bindings[].agentId`、`channels.awada.config.customerdb.agentId`），有引用则 400 并列出——解除后才能停，杜绝悬空路由。
- **provider 凭证轮换**（`lib/config-rpc.ts` `updateModelProvider`）：仅允许更新已存在 provider 的 apiKey/baseUrl（合并语义，未填字段保留原值；引擎 `restoreRedactedValues` 负责打码哨兵还原，`apiKey` 在 config.get 回显为 `__OPENCLAW_REDACTED__`）。**不开放新建 provider**（自定义 provider 需 baseUrl+models 完整定义，`ModelProvidersSchema` superRefine）。
- **agent 模型分配**（`/api/config/agent-model` → `agents.update`）。
- **cron 运维**（`lib/cron-rpc.ts`）：list / run(force|due) / remove / 启停，全部走 gateway 原生 RPC。
- **UI**（`app/(console)/_components/ops-panels.tsx`）：/config 页新增 CrewPanel（已启用+可启用两段，受保护徽标）、ProviderPanel（provider 下拉 + apiKey/baseUrl 输入，key 不回显）、CronPanel（任务行内 运行/启停/删除）。GET /api/config/gateway 响应增加 agents 与 providers（仅 id+baseUrl，无密钥）切片。
- 6 个新路由全部挂 `checkApiAuth`：`/api/config/crews`(GET) `/api/config/crews/toggle` `/api/config/provider` `/api/config/agent-model` `/api/cron`(GET) `/api/cron/action`。

**cron add/update 的评估结论（task 原文"cron CRUD 评估"）**：web 只开放 list/run/remove/toggle，不开放新建与改期。理由：`CronAddParamsSchema` 的 agentTurn payload 需 model/fallbacks/toolsAllow 完整定义、isolated 会话目标约束（实测 systemEvent+isolated 被拒），表单复杂度高且极易配错；cron 任务更适合在 agent 会话内自然语言创建（gateway cron tool 已有此路径），web 承担运维动作（看状态/手动触发/停用/删除）。

**验证证据（同一 throwaway sandbox，`/tmp/xb-p3d-sandbox`，真实 `~/.openclaw` 零写入）**：

| 用例 | 结果 |
|------|------|
| GET /api/config/crews | enabled=[main*,it-engineer*,content-producer]，available=[sales-cs 销售客服·6 技能]（* = 受保护）✅ |
| enable sales-cs | 200 ok；文件 agents.list 新增 entry，workspace 渲染为 `/tmp/xb-p3d-sandbox/workspace-sales-cs`，skills/heartbeat 与 sample 一致 ✅ |
| disable main | 400 "main 为受保护 crew，不可停用" ✅ |
| disable 有 binding 引用的 sales-cs | 400 "存在对 sales-cs 的引用，请先解除：bindings 中 1 条路由指向 sales-cs" ✅（引用经测试 RPC 注入） |
| disable 无引用 sales-cs（无 UI 介入） | 200 ok；entry 移除 ✅ |
| provider baseUrl/apiKey 轮换（dummy key） | 200 ok；文件 baseUrl 更新、apiKey=dummy 值 ✅ |
| provider 不存在 id | 400 "provider 不存在: nonexistent（web 不开放新建 provider）" ✅ |
| agent-model content-producer→bailian-token-plan/glm-5.2 | 200；agents.update 回执 ok，文件 model 字段落盘 ✅ |
| cron list→toggle→run(force)→toggle→remove | 全部 200；run 落 `enqueued:true`、state.lastRunStatus="ok"（22ms）；remove 后 list 为空 ✅ |
| 浏览器 UI：三面板渲染 | CrewPanel 受保护徽标/可启用列表、ProviderPanel 2 选项、CronPanel 任务行（ui-evidence-job@main 每 1440 分钟）✅ |
| 浏览器 UI：停用 content-producer → 列表移入"可启用"→ 启用恢复 | confirm 弹窗→成功提示→列表实时刷新，全闭环 ✅ |
| 真实 gateway 只读冒烟（:3000） | crews enabled=[main*,it-engineer*,content-producer] available=[sales-cs]、cron jobs=[]，与真实状态一致 ✅ |
| tsc / next lint | 0 错误 ✅ |

**已知限制**：

- cron run(force) 仅确认入队（`enqueued`），任务实际执行的会话产物不在 web 展示（可在聊天页对应 session 查看）
- crew 启停后 agent 的心跳/会话在 gateway 重启周期内生效（gateway 自动处理），web 不做二次重启确认
- sample 内容按产品约定信任（与 IT engineer 手工并入同一信任级别），gateway schema 校验兜底非法键
- sandbox 里 content-producer/sample 等测试夹具随 /tmp 清理消失；真实环境启用 sales-cs 的动作未经真实 gateway 演练（零写入约定）

## 2026-09-14 · Phase 3 P3-F：全量验证 + :3000 事故修复

**事故与根因（:3000 全 500）**：P3-F 回归开始时 ：3000 所有页面与 API 一律 500（含本应 401 的无令牌请求）。被停掉的 dev server 日志尾部留有直接证据：`ENOENT …/.next/server/app/page/app-build-manifest.json` 与 `ENOENT …/.next/static/development/_buildManifest.js.tmp.*`。根因：与 dev server 并发执行 `npx next build`（同 `.next` 目录），生产构建覆写 dev 增量产物，dev server 全路由崩。**处置**：原样重启 dev server（`pnpm dev`，环境仅靠 `.env.local` 自动加载 + BFF 服务端从 `~/.openclaw/openclaw.json` 解析 gateway token 的回退路径——重启即验证了该回退）。**预防**：dev server 运行期间不得对同一 distDir 跑 `next build`；构建前先停 dev 或使用独立 distDir。

**验证证据**：

| 用例 | 结果 |
|------|------|
| `next build`（生产构建，无并发 dev） | exit 0，全路由表输出（/ /config /cron /calibration /bd-ir /customers /publish /dna 等 27 条）✅ |
| `tsc --noEmit` | exit 0 ✅ |
| 页面无令牌（/ /config /publish /bd-ir /customers） | 200（鉴权在 API 层，页面为壳，符合 P3-A 设计）✅ |
| 写 API 无令牌 ×8（channel/apply、crews/toggle、provider、agent-model、cron/action、domain/publish/distribute-status、gateway/restart、domain/ir/status） | 全部 401 ✅ |
| 读 API 无令牌（config/gateway、cron、config/crews） | 全部 401 ✅（domain/ir/status GET → 405，方法不符） |
| 带令牌 GET /api/config/gateway（真实 gateway :18789 config.get，只读） | 200：hash 存在、agents 3、channels=[openclaw-weixin]、providers 1、bind=loopback:18789/auth.mode=token ✅ |
| 带令牌 GET /api/cron | 200，jobs=0（真实 store 为空，与 P3-E 冒烟一致）✅ |
| 带令牌 GET /api/config/crews | 200：enabled=[main,it-engineer,content-producer]、available=[sales-cs] ✅ |
| 带令牌 POST /api/domain/ir/status（空 body） | 400（入参校验护栏生效）✅ |
| 带令牌页面 ×5 | 全部 200 ✅ |
| UI DOM 断言（:3000/config） | 配置总览/Channel 绑定/Crew 启停/Provider 轮换/Cron 任务五面板全部渲染；浏览器持陈旧 cookie 的面板显示「缺少或错误的访问令牌」——UI 层鉴权门生效 ✅ |
| BFF gateway-token 回退路径 | dev server 进程环境无 OPENCLAW_GATEWAY_TOKEN（ps eww 核实仅 .env.local 两键），网关认证成功——回退读 openclaw.json 生效 ✅ |
| 真实 `~/.openclaw` 写入 | 零写入（本阶段对真实 gateway 仅 config.get / cron.list 只读冒烟）✅ |

**矩阵勘误**：计划矩阵中的 `/engine` 页面不存在（构建路由表无此路由），404 为正确行为——引擎 dashboard 的实际路由是根 `/`。

## Phase 3 完成声明

Phase 3（安全与配置管理）六个任务全部完成并留证：

- **P3-A** BFF 最小鉴权：loopback 校验 + 写路由共享令牌（commit 9120e50）
- **P3-B** IT engineer apply 脚本与低风险写回 CLI 接口掘取（补录节）
- **P3-C** 低风险域数据写回 API + UI：分发状态/互动补录/IR 状态/客户跟进（commit 0b6be39）
- **P3-D** channel 绑定 GUI：dry-run→确认→apply→重启提示（commit e31b162）
- **P3-E** crew 启停 + provider 凭证轮换 + agent 模型分配 + cron 运维（commit 815f7ca）
- **P3-F** 全量验证 + :3000 事故修复（本节）

Deviation 共 3 处，均已记录：写回统一走 gateway config.patch RPC（不走 IT apply 脚本）；agent 模型分配走 `agents.update`（计划所引 `modelPolicy.allow` 在 v2026.7.1 不存在）；cron 走 gateway 原生 RPC（计划设想的 MCP 桥接不需要）。

安全边界全程保持：真实 `~/.openclaw` 零写入（真实 gateway 仅只读冒烟）；写验证全部在 `/tmp/xb-p3d-sandbox`；令牌/密钥未落日志（sandbox 用 dummy 占位）；web 永不直改 `openclaw.json`（全部经 config.patch 护栏）。多租户与内置 UI 克隆红线未触碰。
