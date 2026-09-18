# xiaobei-web 第三方代码审核报告

> 审核范围：`apps/web/` 全部源码（Phase 1）。审核依据：项目自声红线（`DEVELOPMENT-LOG.md` §隔离承诺 / §遗留事项）+ `apps/web/docs/chat-protocol.md` §12 安全红线 + 代码本身。
> 审核员：Claude（第三方）。日期：2026-09-14。
> 状态：**未做首次 git commit**，本报告供开发 agent 修复后由审核员复审。

---

## 一、红线符合性结论（隔离 / token / 越权）

| 红线 | 结论 | 证据 |
|------|------|------|
| 对 `~/.openclaw` 零写入 | ✅ 符合 | 全仓扫描无 `writeFile/exec/spawn/child_process`；sqlite 全部 `readOnly:true`（`lib/xiaobei-data.ts:16`）；json 全 `readFileSync` 只读 |
| 不占 gateway 端口 18789 | ✅ 符合 | `lib/gateway.ts` 仅 `new WebSocket()` 出站连接，无 `listen` |
| token 不落 git / 不下发浏览器 | ✅ 符合 | `resolveGatewayToken()` 仅服务端（`lib/gateway.ts:64-81`）；`.env.local` 仅 URL；`.gitignore` 含 `.env*`；SSE/POST 响应未回带 token |
| sessionKey 前缀隔离 | ✅ 符合 | `web:<uuid>` + 正则 `^web:[A-Za-z0-9-]{8,64}$` 全路由校验 |
| 不传越权字段 / 不用 chat.inject | ✅ 符合 | `send/route.ts` 仅传 `sessionKey/message/idempotencyKey`，无 §4.1 禁传字段 |

**隔离红线全部守住。** 以下为功能层、健壮性层与代码质量问题，按风险从高到低排列。

---

## 二、发现清单（逐条：证据 / 风险 / 修复建议）

### F1 · [中] BFF 无鉴权，任何本机进程可驱动 main agent
- **位置**：`app/api/chat/{send,abort,history,events}/route.ts` 全部
- **现象**：所有 BFF 路由零鉴权。本机（或能访问 :3000 的同网段）任意进程可创建 `web:` 会话、以 operator 身份向 main agent 发消息，消耗模型额度 / 触发 agent 行为。
- **风险**：中。当前 `next dev` 默认 bind localhost、单租户私有部署，影响有限；但一旦 dev server 暴露网络或多用户共用机器即成漏洞。日志 §遗留事项未列入。
- **建议**：Phase 1 可暂记为已知限制；Phase 3 配置写操作上线前必须加最小鉴权（本地 token / loopback 校验 / 单用户口令）。在 README 或日志"遗留事项"补一条。

### F2 · [中] 幂等键每请求重生 → 超时重试产生重复 run
- **位置**：`app/api/chat/send/route.ts:36`（`idempotencyKey: randomUUID()`）
- **现象**：BFF 每次发送都生成新 idempotencyKey。若 `conn.request` 触发 20s 超时（`lib/gateway.ts:311`）但 gateway 实际已受理该 run，浏览器收到 502/超时错误后用户重试 → 新 key → gateway 视为**新 run**，与协议 §4.3"重试复用同一 key"相悖，导致重复回复 / 双倍额度消耗。
- **风险**：中。deepseek 出字快、本机链路稳，触发概率低；但这是协议正确性缺陷，长文 / 慢模型 / 网络抖动时必现。
- **建议**：把 idempotencyKey 生成上移到浏览器（`app/page.tsx` 已有 `crypto.randomUUID()` 习惯），随 `chat.send` 请求体传入；BFF 透传该 key。浏览器重试同一消息复用同一 key，gateway 自带 `in_flight` 去重。

### F3 · [中] `stripSecrets` 是死代码，密钥剔除名实不符
- **位置**：`lib/xiaobei-data.ts:190-206`（定义）；全仓无调用点（lint `no-unused-vars` 已告警）
- **现象**：函数注释宣称"密钥字段一律剔除"，但**从未被调用**。`/config` 页实际密钥防护完全依赖 `getConfigSummary()` 手挑字段（id/name/model/enabled/baseUrl/api/bind/port/authMode）——这些字段确实不含密钥，所以当前**无泄漏**。但 `stripSecrets` 给人"纵深防御已就位"的假象：若未来某页 `JSON.parse` 原样 dump `openclaw.json`，会以为有兜底，实则没有。
- **风险**：中（安全误标，非当前泄漏）。
- **建议**：二选一——① 在 `getConfigSummary` 返回前对原始 cfg 调一次 `stripSecrets` 作为兜底（即便手挑已安全，多一层保险）；② 删除该函数，避免误导。推荐①。

### F4 · [中] 握手无超时，gateway 静默时 SSE 永久挂起
- **位置**：`lib/gateway.ts:138-262`（`connect()` Promise）
- **现象**：`connect()` 仅在 `ws.on("error")` / `on("close")` 时 reject；若 gateway TCP 接受连接但不发 `connect.challenge`、或发了 challenge 但不回 `hello-ok`，`connect()` Promise **永不 settle**。后果：`events/route.ts` 的 SSE 流一直开着却永不 `ready`，EventSource 因连接"活着"而不重连；`request()` 调用方也会无限挂起。
- **风险**：中。gateway 异常或 sidecar 启动期可触发。
- **建议**：在 `connect()` 内加握手超时（如 15s），到期 `ws.terminate()` + reject；并复用 `scheduleReconnect`。

### F5 · [低] `request` 超时与已受理 run 的 UI 不一致
- **位置**：`lib/gateway.ts:303-319`（20s 超时）、`app/api/chat/send/route.ts:40`
- **现象**：`chat.send` 走 `request()`，20s 未收 res 即 `AGENT_TIMEOUT` 抛错 → 浏览器 502 显示"发送失败"。但 gateway 可能已受理并在流式生成（runId 已通过 SSE 推 `delta`）。结果：用户看到"失败"红框，紧接着同一 runId 的流式文本开始追加到那条"失败"消息里——UI 自相矛盾。
- **风险**：低（体验），与 F2 叠加放大。
- **建议**：① `chat.send` 的 `request` 超时调大或改用协议 `timeoutMs`（run 级而非请求级）；② 超时后不立即标红，先标"仍在生成…"，等收到首个非 delta 终态再定状态。

### F6 · [低] 类型错误：历史消息 role 未收窄（tsc 失败）
- **位置**：`app/page.tsx:144-153`
- **现象**：`npx tsc --noEmit` 报 1 error：`.map` 回调返回的对象 `role` 被推断为 `string`，不匹配 `ChatMsg["role"]`（`"user"|"assistant"`）。根因：数组 `.map` 回调返回类型在无显式标注时，字面量被宽化为 `string`。
- **风险**：低（类型层；运行时值正确，但阻塞 `next build`）。
- **建议**：`role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant"`，或给 map 回调加返回类型标注。

### F7 · [低] `getMediaSummary` 计数含子目录且无上限
- **位置**：`lib/xiaobei-data.ts:179-181`
- **现象**：`readdirSync(dir).length` 把子目录也计入文件数；媒体目录巨大时同步阻塞 server component。
- **风险**：低。
- **建议**：`.filter((f) => f.isFile()).length`；可选加 cap 或改 `opendir` 惰性计数。

### F8 · [低] `chat.history` 不支持分页
- **位置**：`app/api/chat/history/route.ts:13-17`、`app/page.tsx:140-143`
- **现象**：仅透传 `limit`（clamp ≤1000），未透传 `offset`/`nextOffset`；协议 §6 支持 `hasMore`+`nextOffset` 分页，前端未消费。长会话历史 >1000 条时无法补齐。
- **风险**：低（功能缺口，Phase 1 单会话消息量通常 <1000）。
- **建议**：后续按需加 `offset` 参数与"加载更多"UI。

### F9 · [信息] error.message 原样回显浏览器
- **位置**：各 `route.ts` 的 `catch` 块
- **现象**：`err.message`（含 `GatewayRequestError` 来自 gateway 的 `error.message`）直接进响应体。私有部署风险低，但可能泄漏 gateway 内部结构/路径片段。
- **风险**：信息级。
- **建议**：保留现状即可；若日后多租户，统一错误出口、对外只给稳定错误码 + 通用文案，详情留服务端日志。

### F10 · [信息] SSE 转发原始 gateway payload
- **位置**：`app/api/chat/events/route.ts:36-42`
- **现象**：`chat` 事件 payload 原样转发浏览器（含 `message.content`、可能的 `usage` 等字段）。当前仅是用户自己会话内容，可接受；但未做字段白名单，协议若新增字段会自动透出。
- **风险**：信息级。
- **建议**：保持现状；记录"未来如引入多租户需加 payload 白名单"。

---

## 三、工具核验记录

- `tsc --noEmit`：**1 error**（F6），0 其余。
- `eslint .`：0 error / 1 warning（F3 stripSecrets 未使用）。
- 写操作扫描：全仓仅 `DatabaseSync readOnly:true`，无任何写文件/子进程。✅
- `pnpm audit`：npmmirror 无 audit 端点（环境限制），`ws@8.21.3` 为近期版本，未发现已知高危 CVE。

---

## 四、修复优先级建议（给开发 agent）

| 优先级 | 项 | 一句话 |
|--------|----|--------|
| P0 | F6 | 修 tsc 类型错误（否则 `next build` 失败） |
| P1 | F3 | `stripSecrets` 接线或删除（安全误标） |
| P1 | F4 | 握手加超时（防 SSE 永久挂起） |
| P2 | F2 + F5 | idempotencyKey 上移浏览器 + 超时 UI 处理（协议正确性） |
| P2 | F1 | 在日志/README 记"无鉴权"为已知限制，Phase 3 前补 |
| P3 | F7、F8 | 媒体计数 / 历史分页（体验） |
| 记录 | F9、F10 | 信息级，多租户化时再处理 |

---

## 五、未覆盖 / 待 Phase 3 复审项

- Phase 3 配置写操作（`/api/config/*` shell 调 IT apply 脚本）尚未实现，届时重点复审：命令注入、dry-run、.bak 回滚、重启确认、是否仍零直改 `openclaw.json`。
- 停止按钮的"中止-事件闭环"未经真机流中验证（模型出字太快，见日志 T5 遗留①）——建议用慢模型或长文压测复验。
- `chat.inject` 已按红线不使用，确认代码无引用。✅

---

*审核员备注：隔离红线是本项目的立身之本，Phase 1 守得很好。以上发现集中在协议正确性（F2/F5）、连接健壮性（F4）与一处类型阻塞（F6），均不触及红线。修复后请告知，复审将聚焦改动点。*

---

# Phase 2 复核（域 dashboard：业务数据只读视图）

> 范围：`lib/xiaobei-domain.ts` + 6 业务页（publish/dna[+详情]/calibration/bd-ir/customers/videos）+ `_components/markdown.tsx` + 分组导航。
> 静态检查：`tsc --noEmit` 0 error、`eslint .` 0 error/0 warning。

## 红线复核：全绿 ✅

| 红线 | 证据 |
|------|------|
| `~/.openclaw` 零写入 | 写操作/子进程扫描全空，仅 `DatabaseSync readOnly:true` + `readFileSync/readdirSync` |
| SQL 注入 | 唯一拼接 `SELECT * FROM ${name}`（`:125`），`name` 来自 `sqlite_master` 枚举 + `/^pub_[a-z0-9_]+$/` 守卫，非用户输入 |
| 路径穿越 | `readWorkspaceTextFile:60` `resolve()+startsWith(MAIN_WS+sep)` 挡 `..`/绝对路径；`platform/dnaId` 经 `^[A-Za-z0-9_-]+$` 校验 |
| markdown XSS | 无 `rehype-raw`，原始 HTML 转义；默认 `urlTransform` 过滤 `javascript:` |
| token/越权 | Phase 2 纯只读 server component，不触 BFF chat 路由 |

## Phase 2 发现（4 条，均低/信息级，无阻塞）

### F11 · [低] gateB 里程碑被计算却未渲染
- 位置：`lib/xiaobei-domain.ts:471`（type 有 gateB）、`:494`（FILES 有 gateB）、`:504-517`（LABELS 漏 gateB）
- 现象：里程碑定义 13 项含 gateB，但 `VIDEO_MILESTONE_LABELS` 只 12 项 → `videos/page.tsx:35` 按 LABELS 渲染，gateB checkpoint 已算却永不显示。
- 修复：`VIDEO_MILESTONE_LABELS` 在 `gateA` 后补 `["gateB", "闸门B"]`。

### F12 · [低] 多表查询容错粒度过粗
- 位置：`lib/xiaobei-domain.ts` `getBdData:271`、`getIrData:372`、`getCustomerData:431`
- 现象：单一 `try` 包裹两表 `prepare()`；第二表缺失抛错时 `catch` 返回全空，丢弃第一表已查数据。`init-db.sh` 原子建表，概率低。
- 修复：按表独立 try/catch 或先查 `sqlite_master` 过滤存在的表名。

### F13 · [低] 外链 href 无协议白名单
- 位置：`publish/page.tsx:78`、`bd-ir/page.tsx:71,120`
- 现象：DB 字段直接作 `<a href>`，若库内出现 `javascript:`/`data:` URL 点击即 XSS。数据由 agent 写入，风险低。
- 修复：小工具 `safeUrl(u)` 仅放行 `^https?:`，外链 href 套一层。

### F14 · [信息] 路径守卫不解析 symlink
- 位置：`lib/xiaobei-domain.ts:60`
- 处置：当前威胁模型下安全（workspace 由 agent 控制、web 零写入、入参经正则校验），不修，仅记录。未来 workspace 接受外部写入输入时改 `realpath` 校验。

## Phase 2 修复优先级

| 优先级 | 项 | 一句话 |
|--------|----|--------|
| P3 | F11 | LABELS 补 gateB（一行） |
| P3 | F12 | 多表独立 try/catch |
| P3 | F13 | 外链协议白名单 |
| 记录 | F14 | 不修，留意 |

## 评估结论：可继续推进 ✅
Phase 2 红线全绿，双零静态检查，4 条发现均低/信息级无阻塞。F11–F13 修复后可继续 Phase 3。

*Phase 2 复核员备注：域数据层把 SQL 拼接与路径穿越两处高风险点守住了，markdown 渲染选型正确（无 rehype-raw）。剩余均为纵深防御与一处 UI 漏项。修复后复审聚焦改动点。*

---

# Phase 3 复核（安全与配置管理：引入写操作）

> 范围：鉴权 `lib/api-auth.ts`+`lib/client/api.ts`；域写回 `lib/xiaobei-write.ts`+`lib/api-script.ts`+4 路由；config 写回 `lib/config-rpc.ts`+`lib/config-templates.ts`+`lib/crew-rpc.ts`+`lib/cron-rpc.ts`+8 路由；3 个写组件。这是最高风险阶段——首次引入对 `~/.openclaw` 与 `openclaw.json` 的写路径。
> 静态检查：`tsc --noEmit` 0 error、`eslint .` 0 error/0 warning。

## 红线复核（Phase 3 升级后的写边界）：全绿 ✅

| 红线 | 结论 | 证据 |
|------|------|------|
| web 永不直改 `openclaw.json` | ✅ | 全部经 gateway `config.patch` RPC（`config-rpc.ts:93`、`crew-rpc.ts:94/137`、`config-rpc.ts:208`）；schema 校验/密钥还原 `restoreRedactedValues`/`baseHash` 乐观并发/`replacePaths` 破坏性意图确认/.bak 轮转均由 gateway 护栏把关 |
| 真实 `~/.openclaw` 零写入 | ✅ | 写验证全在 `/tmp/xb-p3d-sandbox`（日志 P3-D/E）；真实 gateway 仅 `config.get`/`cron.list` 只读冒烟；BFF 写操作扫描仅 `appendFileSync`（写令牌到项目内 `.env.local`，不触 `~/.openclaw`） |
| 域 DB 写回不直连 sqlite | ✅ | `xiaobei-write.ts` 经 `execFile("bash",[script,...args])`（参数数组、无 shell）调 agent 脚本，不 `DatabaseSync` 写 |
| 鉴权全覆盖 | ✅ | 全部 17 个 `/api` 路由（chat×4 / config×6 / cron×2 / domain×4）顶部挂 `checkApiAuth`；OS `-H 127.0.0.1` 绑定 + 共享令牌 `timingSafeEqual(sha256)` 双防线 |
| 命令/SQL 注入 | ✅ | execFile 无 shell（参数原样传递）+ 双重白名单：路由层（整数/枚举）→ 写层复检（`INT_RE`/`METRIC_COL_RE`/`TEXT_RE`/`IR_STATUSES`）；脚本侧另有单引号转义 |
| 越权字段 / scopes | ✅ | gateway connect scopes 增补 `operator.admin`（`gateway.ts:201`）；config 片段全由服务端模板生成，浏览器只上送 `kind+凭证`（`config-templates.ts:189 parseChannelRequest`） |
| 密钥不落前端 | ✅ | 预览 `maskChannelPatchSecrets` 打码 awadaKey/appSecret；`config.get` 回显 `__OPENCLAW_REDACTED__`；ProviderPanel key 不回显；令牌不进日志 |

## Phase 3 发现（4 条，1 低 + 1 低 + 2 信息，无红线违规）

### F15 · [低] `updateMetrics` 列白名单仅校验形状，可绕过"cal_* 不开放"设计意图
- **位置**：`lib/xiaobei-write.ts:20` `METRIC_COL_RE=/^[a-z][a-z0-9_]{0,39}$/`、`:90-95` push `--${col}`
- **现象**：日志 P3-C 声明"cal_* 校准列不开放（content-calibrator 职责）"，但写层只校验列名**形状**，未排除 `cal_*` 前缀、也未对齐 `getMetricColumns()` 的真实指标列清单。绕过 UI 直接调 API（持令牌）可写 `--cal_score_pv 100` 之类校准列。脚本若动态拼 `SET <col>=<val>` 即落库。
- **风险**：低（令牌门内、本地单用户），但是设计意图与实现的不一致。
- **修复**：`updateMetrics` 内对列名加 `!col.startsWith("cal_")` 排除，或调 `getMetricColumns(platform)` 取真实列集做白名单。

### F16 · [低] 令牌生成用 `Math.random()`（非密码学安全熵）
- **位置**：`lib/api-auth.ts:53` `createHash("sha256").update(\`${pid}-${Date.now()}-${Math.random()}\`)`
- **现象**：自动 provisioning 的令牌熵源非 CSPRNG。OS loopback 绑定是真实边界，令牌是第二层，影响有限。
- **修复**：改 `crypto.randomUUID()`（一行，熵更强）。

### F17 · [信息] crew 启停依赖 gateway 对 `agents.list` 的 id-keyed merge 语义
- **位置**：`lib/crew-rpc.ts:94` enableCrew 发 `{agents:{list:[entry]}}` 不带 `replacePaths`
- **现象**：若 gateway 把 `agents.list` 当普通数组合并（整体替换），enableCrew 会把整个 agent 列表替成单条——误停全部 agent。dev 已在 sandbox 真实 gateway 实证"新增不覆盖"（日志 P3-E），且掘取自 `merge-patch.ts`；但按真实 `~/.openclaw` 零写入约定未做真实演练。
- **处置**：不修（语义已证）。首次真实启停 crew 前，用 `config.get` preview 复核 `agents.list` 完整性即可。

### F18 · [信息] "失败后复核判成功"启发式在并发外部变更时可能误报
- **位置**：`lib/config-rpc.ts:104` `channelLanded`+hash 变化判成功、`:215` provider 同模式
- **现象**：gateway 自动重启掐断响应后，退避取 `config.get` 复核写盘。若期间有**并发外部变更**恰好改了 hash 且目标 channel 已启用，会误报本次 patch 成功。属重启竞态的必要兜底，可接受。
- **处置**：不修，记录。

## Phase 3 修复优先级

| 优先级 | 项 | 一句话 |
|--------|----|--------|
| P3 | F15 | `updateMetrics` 排除 `cal_*` 列 / 对齐真实指标列 |
| P3 | F16 | 令牌生成改 `crypto.randomUUID` |
| 记录 | F17 | 首次真实启停 crew 前 preview 复核 |
| 记录 | F18 | 不修 |

## 评估结论：可继续推进 ✅
Phase 3 是立项目标中风险最高的阶段（首次开写面），但红线守住：`openclaw.json` 全程经 gateway `config.patch` 护栏、真实 `~/.openclaw` 零写入、域写回经 execFile 脚本白名单、17 路由鉴权全覆盖、命令注入双白名单。tsc/eslint 双零。仅 F15/F16 两处低危纵深防御 + 2 信息项，无阻塞。修完可视为 Phase 3 收尾。

*Phase 3 复核员备注：脚本信任边界处理得很好——execFile 无 shell + 路由/写层双重白名单是教科书级纵深防御；config 写回复用 gateway 原生 `config.patch` 护栏（而非自研写盘）是正确选型，把 schema/并发/.bak/重启都甩给引擎。最大残余风险是 F17 的数组合并语义依赖，sandbox 已证但真实环境未演练——首次真实写操作务必 preview。整体可推进。*

---

## 五、Phase 4 计划审核（功能逻辑 / 好用性视角）

> 审核对象：`PHASE4-PLAN.md`（计划文件，非源码）。审核重点：**功能逻辑与好用性**（用户明确要求"功能方便好用"）。技术红线为辅。
> 审核员：Claude（第三方）。日期：2026-09-15。

### 1. 决策链核验（§1–§4）：成立 ✅
- §1 能力图谱（13 域）与 §2 web 现状盘点（13 页/18 API）事实准确，与代码现状吻合。
- §3 覆盖矩阵 ✅/◐/❌ 三档判定成立（对话✅全功能、渠道◐仅 awada/feishu、内容生产/发布◐观测有发起无、登录态❌完全不可见、多租户❌未启动）。
- §4 优先级推导无跳步：缺口 1（执行类发起入口）覆盖 5 域、缺口 2（登录态）属"断链风险"、SaaS 顺延 Phase 5。可检验依据自洽。
- 一处可商榷：把"定时任务创建"归入缺口 1 用指令库解，但 NL→cron 非确定性强（见 P7），效果存疑——建议仍可入此阶段但加"强制 /cron 确认"闭环，或降级 backlog。

### 2. 技术地基：已验证 ✅
§6A 的核心主张——`agent:<agentId>:web:<uuid>` 直达目标 agent + agentId 与 sessionKey 一致性校验 + agents.list 存在性校验 + 未存在报错路径——已对照引擎源码逐条核实：

- `src/sessions/session-key-utils.ts`：`agent:` 前缀路由 scopedRe，`agent:<id>:` 结构性头部匹配，直达到对应 agent 会话空间 ✅
- `src/gateway/server-methods/chat.ts`：agentId 必须与 sessionKey 内嵌 agentId 一致（不一致即报 "agentId does not match session key"）✅
- `ChatSendParamsSchema`：agentId 为可选 NonEmptyString ✅
- agents.list 存在性校验存在，未存在报 "Agent no longer exists" ✅

**结论：快捷指令路由零网关改动，技术可行。** §6A 的可行性证据属实，是本计划最关键的承重墙，已验。

### 3. §8 红线：两条新增红线充分 ✅
- **cookie 值绝不回显**：API 与 UI 只出元数据（name 存在性/expires/updated_at），绝不返回 cookie value——设计到位，与风控要害匹配。
- **sales-cs 不受 web 直发指令**：sales-cs 是对外 crew，targetAgentId 白名单 `{main, content-producer, it-engineer}` 服务端校验——隔离对外 crew 合理。
- **补一条建议**：it-engineer 直发指令（§10.5 开放项）若开放，应限定为"只读诊断"类指令（不触发写/重启），与 P3-E it-engineer 受保护语义一致；否则把白名单收紧为 `{main, content-producer}` 更稳。

### 4. 功能逻辑 / 好用性问题（P1–P8，按影响排序）

#### P1 · [高] 长程产物无完成反馈闭环——"发起→观测"断链
- **现象**：指令发给 content-producer（视频 14 阶段，可跑数十分钟到数小时）。SSE 只覆盖 agent 单轮文本回执（"好的，开始做"），agent 异步产物完成不会推送给 web。用户只能手动刷 `/videos`。
- **影响**：这是"发起类"功能最易踩的坑，与"好用"目标直接冲突——用户发完指令不知道什么时候去看结果、去哪看。
- **建议**：① 发送成功回执里给"去 /videos 查看"直达链接，带 `sessionKey` 过滤定位本次指令产出的新增项；② `/videos` 按 sessionKey/指令关联，新项高亮；③ v2：gateway 有 `task`/`sessions.changed`/`session.operation` 事件（协议 §10），可经 BFF SSE 推完成提醒（需 T1 掘取确认事件形态）。

#### P2 · [高] 用"会话列表"承载指令结果是错抽象
- **现象**：一次 content-producer 指令 = 一个 `agent:content-producer:web:<uuid>` 会话。下 3 条指令 = 3 个会话散落。用户心智模型是"我下了什么指令/结果如何"，不是"我和 content-producer 的第 N 个会话"。T3 用"会话列表/切换"承载指令结果，抽象错位。
- **影响**：用户找回指令产物困难，指令库价值打折扣。
- **建议**：顶层做**指令历史**视图（commandId/label/状态/产物直达链接/时间），底层才是会话。T3 别只做"会话列表/切换"。会话切换退为指令历史点击进入的二级视图。

#### P3 · [中] 指令卡无 disabled-agent 前置门控
- **现象**：content-producer 停用时，用户填完参数点发送才报错"Agent no longer exists"。坏 UX——前置已知状态没体现在卡片上。
- **建议**：卡片读 `/api/config/crews` 状态，目标 agent 停用时卡片置灰 + "需先启用"提示（可一键跳 `/config` 启用后再发）。§6A 已提"目标未启用的报错路径"在 T1 验证，但缺 UX 前置门控设计。

#### P4 · [中] 登录态只监控不修复——缺动作闭环
- **现象**：`/logins` 显示"douyin 临期 3 天"但页内无"重新登录"动作（re-login 是 agent 的 login-manager 动作）。监控到一个问题却不能在原地解决。
- **建议**：与指令库联动——临期/已过期卡片带"委托重新登录"按钮（POST /api/chat/command，commandId=login-manager 重登指令，targetAgentId=main）。既补闭环，又示范指令库价值，两个 feature 互相成就。

#### P5 · [中] 参数表单未定可用性规范
- **现象**：计划 §7.1 params 只有 `{key, label, type, required, options?}`，没提 placeholder / help text / 默认值 / 内联校验 / 错误文案。12–16 条指令的填参体验会参差。
- **建议**：补参数设计规范——每 param 增 `description`（作 help text）+ `placeholder` + `defaultValue` + 校验失败的内联提示。

#### P6 · [低] 多会话改造对既有 chat 页的回归边界不清
- **现象**：§10.5/T3 改造既有 chat 页支持多会话。当前 chat 页单 sessionKey（localStorage）。加多会话涉及历史恢复 / SSE 绑定 / 中止按钮 runId 归属，回归风险。
- **建议**：T3 拆"会话切换骨架"（T3a）与"指令卡"（T3b）两步，先保单会话回归不破；会话切换明确交互（未读标记、流式中会话标识）。

#### P7 · [低] cron 创建指令非确定性
- **现象**：系统类指令"自然语言描述→agent 调 cron tool"——用户无法在创建前核对解析出的 schedule，可能建错。
- **建议**：该指令发送后引导去 `/cron` 核对新建任务（闭环链接），文案注明"需到 /cron 确认调度"；或干脆降级 backlog（与 §4 可商榷项呼应）。

#### P8 · [低] prompt 预览的确定性错觉
- **现象**：预览给用户"将精确执行此 prompt"的暗示，但 agent 可能改写/路由。
- **建议**：预览文案标注"将以此委托 agent，实际执行由 agent 判断"。

### 5. 结论
计划决策链扎实、技术地基（§6A）已对照引擎源码验证、红线设计到位。但**好用性有三个硬缺口**：

1. 长程产物无完成反馈（P1）——发完不知道去哪看结果
2. 指令历史错抽象成会话列表（P2）——找回指令产物困难
3. 监控页缺动作闭环（P4）——登录态问题不能原地解决

**建议把 P1–P5 纳入本阶段范围**（P1/P2/P3 影响指令库核心体验，P4/P5 是登录态/表单的基础可用性），P6–P8 作为实施细节落实。仅按现计划实施，"快捷指令库"会变成"发完就丢、用户不知道结果去哪看"的半成品。

### 6. 修订任务条目建议（供开发 agent 直接改 PHASE4-PLAN.md §9）

> 基于上方 P1–P5，给出可落地的 T1–T5 修订。T6/T7 不变。

- **T1（补充）**：掘取时增加"gateway 是否有 task/sessions.changed/session.operation 完成事件可用于 SSE 推送"的结论（为 P1 v2 铺路，非阻塞本阶段）。
- **T2（修订）**：指令目录 + BFF。catalog 条目结构增 `description`（卡片副标题/help text）；每 param 增 `placeholder`/`helpText`/`defaultValue` 字段（P5）；POST /api/chat/command 成功响应回带 `{sessionKey, commandId, observationHint: {page: "/videos"|..., filter: {sessionKey}}}` 供前端做"去观测"直达链接（P1）；targetAgentId 白名单 `{main, content-producer, it-engineer}` 服务端校验（§8 复述）。
- **T3（修订，拆两步）**：
  - T3a 会话切换骨架（保单会话回归不破，先验历史恢复/SSE 绑定/中止 runId 归属）（P6）
  - T3b 指令卡 UI：分组卡 → 参数表单（含 placeholder/helpText/内联校验）→ prompt 预览（文案标注"委托 agent，实际执行由 agent 判断"，P8）→ 发送。卡片读 `/api/config/crews` 状态做 disabled-agent 前置门控（置灰 + "需先启用"跳 /config）（P3）。**新增顶层"指令历史"视图**：commandId/label/状态/产物直达链接/时间，底层才是会话（P2）。发送成功回执渲染"去 /videos 查看"直达链接，带 sessionKey 过滤定位新增项（P1）。
- **T5（修订）**：/logins 页 UI——平台卡片 + 预警汇总条（可点击跳平台卡）+ 五状态渲染；**临期/已过期卡片带"委托重新登录"按钮**（POST /api/chat/command，commandId=login-manager 重登指令，targetAgentId=main），实现监控→动作闭环（P4）。

### 7. 验证方式
- 人工核对 P1–P8 每条都有"问题 + 建议"两要素
- 修订任务条目可被开发 agent 直接映射到 PHASE4-PLAN.md §9 的编辑动作
- 实施后由审核员复审改动点（P1/P2/P3 改 T2/T3，P4 改 T5）

---

## 六、Phase 4.5 计划审核（体验闭环：完成推送 + 登录态探活）

> 审核对象：`PHASE4.5-PLAN.md`（计划文件）。审核重点：**功能逻辑与好用性**（沿用 §五口径）。本阶段是 Phase 4 遗留断链（P1 完成推送 + 登录态探活盲区）的收口。
> 审核员：Claude（第三方）。日期：2026-09-16。

### 1. 技术地基：已对照引擎源码全量验证 ✅
§2 "已证实"三项逐条核实（引擎仓 `~/xiaobei/openclaw`）：

| 计划声明 | 引擎证据 | 判定 |
|---------|---------|------|
| gateway 广播 `sessions.changed` | `src/gateway/server-methods/session-change-event.ts`（`emitSessionsChanged`）；`server-broadcast.ts:48` `"sessions.changed": [READ_SCOPE]` | ✅ |
| 载荷含 `{sessionKey, agentId, reason, hasActiveRun, activeRunIds, ts}` | `SessionChangedPayload={sessionKey?,agentId?,reason,compacted?}` + 广播时 `buildGatewaySessionEventFields`/`buildSessionEventSnapshot` 注入 `hasActiveRun/activeRunIds`（`server-chat.ts:459`）+ `ts:Date.now()` | ✅ 字段全在 |
| 完成沿可行（run 结束 → hasActiveRun=false 广播） | `server-chat.ts:731-740` `broadcastSessionChange` 在 chat 生命周期 phase 翻转时广播，snapshot 经 `:459` 带 `hasActiveRun: activeRunState.active` | ✅ 可行（时序仍需 sandbox 实抓确认） |
| scope 足够，无需改握手 | `READ_SCOPE` 由 BFF 既有 `operator.read` 覆盖（Phase 1 scopes） | ✅ **T1.2 可降级为确认项** |
| BFF 帧只分发 chat 事件，需扩展 | `apps/web/lib/gateway.ts:265` `frame.event === "chat"` 唯一分支 | ✅ |
| 渠道会话可服务端过滤 | `isValidWebSessionKey`（`gateway.ts:370`）匹配 `^web:` + `^agent:<id>:web:`，渠道会话（`agent:*:awada:*`/feishu）不匹配 | ✅ 红线可执行 |

**结论：完成推送技术地基成立。** §2 事实准确，T1 掘取问题问对了关键。可回填：T1.2（scopes）已确认无需改握手；T1.1 feasibility 已确认，留 sandbox 实抓时序；T1.3（OFB_KEY/pong）仍未掘取，是 T3 选型的唯一阻塞项，应优先。

### 2. §4 红线：到位 ✅
- 新路由鉴权、通知只元数据不含消息内容、渠道会话 BFF 服务端过滤、cookie 零回显、零直改——设计到位。`isValidWebSessionKey` 已能执行"渠道会话永不出 BFF"。
- 补一条：sessions-events SSE 转发的 `hasActiveRun`/`activeRunIds` 为布尔+runId，不含会话内容，安全 ✅（已核）。

### 3. 功能逻辑 / 好用性问题（Q1–Q6，按影响排序）

#### Q1 · [高] NotificationBell 挂载位置与"全页面可见"目标矛盾
- **现象**：§3.1 称铃铛挂 `console/layout.tsx`、"全页面可见（不止 chat 页）"。但 `app/page.tsx`（聊天/指令页）在根 layout，**不在 `app/(console)/` 分组**（已核目录结构）。挂 console layout → 指令页本身看不到铃铛——而指令页正是发指令的地方，用户发完切到别的页才看到铃铛，反了。
- **建议**：挂根 `app/layout.tsx`（chat + console 均覆盖），或两个 layout 都挂。否则 P1 闭环在最关键的页面缺位。

#### Q2 · [高] 完成沿无法区分"成功/失败/中止"——"已完成"误导
- **现象**：§3.1 完成判定只看 `hasActiveRun` true→false 翻转；指令记录仅"进行中/已完成"两态（line 58）。run 失败/中止也是 false 沿 → 失败的视频委托也显示绿色"已完成"，用户被误导去 /videos 找不存在的产物。
- **证据**：引擎 chat-lifecycle 广播带 `phase`/`runId`（`server-chat.ts:731-740`），且 chat 事件流有 `chat.final`/`chat.error`/`chat.aborted`——可取 outcome。
- **建议**：指令记录三态"进行中 / 已完成 / 已出错（红）"；铃铛条目带状态色。数据源：完成沿触发时对该 sessionKey 拉一次 `chat.history` 取末条 outcome 枚举（不取消息内容，只取状态）。这把 Q2 与"通知只元数据"红线对齐。

#### Q3 · [中] 离线期间完成的指令无任何通知痕迹
- **现象**：§3.1 初始校准明确"不补弹"防堆积（line 56）。但用户关页 → run 完成 → 重开：指令记录 Tab 会经 sessions.list 校准为"已完成"（line 58），铃铛却不显示。用户若不点指令记录 Tab 就完全错过。
- **建议**：重开页面时对名册内"上次访问时间戳之后完成"的条目，铃铛显示**静默未读角标**（不弹窗、不响），用 `notif-read` 时间戳与会话完成 `ts` 比较。一次一次性补，不堆积。

#### Q4 · [中] T3 探活若只能走 agent 指令路径，盲区只关一半
- **现象**：§3.2 探活路径二选一：execFile（若 OFB_KEY 可外调）或经 `/api/chat/command` 发 relogin 指令 → main（agent-path）。若 agent-path-only，探活=一次 agent run，成本/延迟同聊天一轮，**不适合"进页面自动探测预警平台"**。则第六状态只在用户手动点"探测"时显现——用户不主动怀疑，本地"有效"实为失效的盲区仍在。
- **建议**：T1 先定 OFB_KEY 可达性（最关键掘取项）。若 agent-path-only，T3 明确只做"手动探测 + 显著引导文案"（卡片直接显示"本地判定有效，但服务端可能已失效，点此探测"），不承诺自动探测；风控闭环的诚实边界写进 DEVELOPMENT-LOG。

#### Q5 · [低] 多标签页"不跨页同步"框架描述不准
- **现象**：§3.1 称"每标签独立 SSE，通知不跨页同步"。但 `notif-read` 存 localStorage（**跨标签共享**）。实际是数据共享、无 live propagation——A 标签已读，B 标签角标不衰减直到刷新。
- **建议**：要么承认"v1 接受不同步"，要么加 `window.addEventListener('storage')` 廉价跨标签同步已读/未读数（改动量极小，体验提升明显）。

#### Q6 · [低] 兜底轮询仅铃铛打开时——漏发场景静默
- **现象**：§6 兜底 = 名册会话 hasActiveRun 30s 轮询，仅铃铛打开时。若 sessions.changed 漏发且铃铛关闭，用户完全收不到完成信号，直到开铃铛触发轮询。
- **建议**：页面加载时（不限铃铛打开）做一次 sessions.list 校准名册状态作为"打开即补"一次性兜底；持续轮询仍限铃铛打开时。

### 4. 结论
技术地基（完成推送）已对照引擎源码全量验证成立，§2 事实准确，红线设计到位，T1 掘取问对了关键且可部分回填。

但**好用性有两处硬缺口**：
1. **Q1 铃铛挂载位置反了**——指令页本身看不到铃铛，闭环在最关键页面缺位
2. **Q2 完成沿不区分成败**——失败也显示"已完成"，误导用户去找不存在的产物

Q3/Q4 是闭环的"最后一公里"（离线完成痕迹、探活盲区的诚实边界），Q5/Q6 是低成本优化。建议 Q1/Q2 纳入本阶段必改（影响核心体验），Q3/Q4 视 T1 结论定夺，Q5/Q6 作为实施细节。

### 5. 任务条目修订建议（供开发 agent 改 PHASE4.5-PLAN.md §5）

- **T1（回填）**：T1.2 scopes 已确认（READ_SCOPE，operator.read 足够，无需改握手）→ 降为确认项；T1.1 feasibility 已确认 → 留 sandbox 实抓时序；**T1.3 OFB_KEY 可达性优先掘取**（T3 选型唯一阻塞项）。
- **T2（修订）**：NotificationBell 挂载点改 `app/layout.tsx`（或双 layout），覆盖 chat 页（Q1）；完成沿触发时对 sessionKey 拉 `chat.history` 取末条 outcome，指令记录三态"进行中/已完成/已出错"（Q2）；重开页面静默角标补离线完成（Q3）；可选加 `storage` 事件跨标签同步（Q5）；页面加载一次性 sessions.list 兜底（Q6）。
- **T3（修订）**：按 T1.3 结论——OFB_KEY 可外调走 execFile（可自动探测预警平台）；agent-path-only 则只做手动探测 + 显著引导文案，不承诺自动探测，诚实边界入日志（Q4）。

### 6. 验证方式
- 引擎证据行号已随行（§1 表），可逐条复核
- Q1/Q2 改动后：sandbox 造失败沿（假 key 快速失败）→ 断言指令记录显示"已出错（红）"而非"已完成"；chat 页可见铃铛
- 复审改动点：T2 挂载点 + 三态、T3 探活路径选择

### 7. 实施复核（2026-09-17，dev T2–T4 落地后）

开发 R1–R6 改动清单与代码逐条核实，**无虚假映射**：

| 审核项 | 清单声明 | 代码核实 | 判定 |
|--------|---------|---------|------|
| Q1 铃铛挂载 | 根布局 `app/layout.tsx` 挂 `<NotificationBell />` | `app/layout.tsx:20`（非 console layout）→ chat 页可见 | ✅ |
| Q2 完成沿成败区分 | `chat-terminal` 剥离至 `{sessionKey, runId, state}`；三态 | `sessions-events/route.ts:50` 三字段；`:19` TERMINAL_STATES=final/error/aborted | ✅ |
| Q3 离线完成痕迹 | outcome 持久化；`unread = endedAt > readMap[sk]` | `notifications.ts:7` OUTCOMES_KEY、`:104` isUnread——重开天然产徽标 | ✅ |
| Q4 探活路径 | 分支 A：execFile check-login.ts + 平台白名单 + 三态 + 自动探测 | `xiaobei-probe.ts:35` execFile、`:62/67/74` 三态；`probe/route.ts:23` 白名单 400；`logins-board.tsx:74` 自动探测预警平台、`:92` 探活结论优先本地 | ✅ |
| Q5 跨标签同步 | storage 事件监听 | `notification-bell.tsx:129`、`page.tsx:324` | ✅ |
| Q6 兜底 | 挂载即校准 + 30s 轮询 | `notification-bell.tsx:53` on-mount /api/chat/sessions、`:141` setInterval 30_000 | ✅ |

**T1 掘取补回一处计划与审核均漏的缺口**：`sessions.changed` 仅发订阅连接（`session-change-event.ts:25` getSessionEventSubscriberConnIds，空集 return），需主动 `sessions.subscribe`。dev 已加 `gateway.ts:139 subscribeSessionEvents()`。T1 掘取在此证明了价值。

**红线复核（增量）**：sessions.changed 快照在 BFF 剥离为 5 元数据字段（`gateway.ts:301`）才进 SSE；chat-terminal 仅 3 字段，零消息内容；sessions-events 经 `isValidWebSessionKey` 双路过滤（`:41/:48`），渠道会话不出口；探活只出状态+引擎 reason，零 cookie；execFile 无 shell + 平台白名单；真实 `~/.openclaw` 零接触（HOME 隔离 pong 缓存）。**全绿**。

**未浏览器实测项（dev 已透明声明，非隐藏缺口）**：
1. 真实"已完成"绿色徽标全链路——sandbox agent 必失败，靠注入 outcome 验渲染层；生产 agent 正常完成走同一终态路径（`chat.final` → chat-terminal state=final）。可接受。
2. 真双标签 storage 事件——被弹窗拦截，改模拟验证；storage 为浏览器原生机制、监听布线已验。可接受。
3. Q2 边界：false 沿无终态时兜底按"已完成"——T1 实证终态先于完成沿（正常路径终态先到、以终态为准）。仅当 SSE 断连期间丢终态帧才误报成功，低概率。

**结论：可继续推进 ✅。** Phase 4.5 闭环达成——长程任务完成推送（成败可辨）+ 登录态服务端探活（盲区收口、诚实边界到位）。Phase 4 遗留断链 P1（发起→观测）至此真正闭环（直达链接 + 完成铃铛 + 成败状态）；登录态从"只监控"进到"监控+探活+重登联动"。单租户形态稳定，SaaS 可在其上动 auth/数据层。
