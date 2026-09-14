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
