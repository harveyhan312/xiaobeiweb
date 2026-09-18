# Phase 4.5 计划：体验闭环（完成推送 + 登录态探活）

> 日期：2026-09-16。状态：**审核意见（§六 Q1–Q6）修订纳入（§八）并已实施**。
> 前置：Phase 4 已完成并过审（commit 832b585；AUDIT-REPORT §五 P1–P8 修订全部落地）。
> 与 Phase 5 的关系：SaaS 多租户仍为下一大阶段；本阶段是"单租户形态稳定"的最后一个小迭代（1.5–2 天量级），完成后 SaaS 可在完全闭环的单租户形态上动 auth/数据层。

## 0. 决策链

```
Phase 4 遗留断链（事实，AUDIT-REPORT P1 + DEVELOPMENT-LOG 已知限制）
  → 长程任务"发完不知道何时好"：只有直达链接，无主动通知（P1-v2 已掘取证实可行）
  → 登录态"本地未过期 ≠ 服务端有效"：预警两类误差之一，需探活
  → 主理人定夺（2026-09-16）：本阶段 = T2 完成推送 + T3 pong 探活；
    提醒形态 = 页内铃铛/徽标（不做浏览器系统通知）；
    backlog 小项（媒体缩略图/渠道模板扩充）不并入；
    → SaaS 顺延不变
```

## 1. 目标 / 非目标

**目标**
1. 指令产生的长程任务完成时，用户在任意 console 页面都能被动得知（页内铃铛 + 未读徽标），并可一键跳转到对应会话/观测页。
2. 指令记录条目具备"进行中 → 已完成"状态可见性。
3. /logins 增加服务端探活，消除"本地未过期但服务端已失效"的盲区。

**非目标**
- 浏览器系统通知（Notification API）——主理人已定不做
- 跨设备指令历史同步（需引擎侧支持，v2）
- sessionKey 过滤高亮（backlog，Phase 4 §12 已定）
- 媒体缩略图、渠道模板扩充（backlog，不并入）
- SaaS 多租户任何前置改造

## 2. 技术前提（Phase 4 T1 已掘取部分 + 本阶段 T1 补掘）

**已证实（Phase 4 T1 + 审核员 §六.1 对照引擎源码全量核验）**：
- gateway 广播 `sessions.changed` 事件（引擎 `src/gateway/server-methods/session-change-event.ts` `emitSessionsChanged`；`server-broadcast.ts:48` 该事件挂 READ_SCOPE），载荷 `{sessionKey, agentId, reason, hasActiveRun, activeRunIds, ts}`——完成推送的事件源成立。
- 完成沿可行：`server-chat.ts:731-740` 在 chat 生命周期 phase 翻转时广播，snapshot 带 `hasActiveRun`（时序与漏发仍需 sandbox 实抓确认）。
- scopes 无需改握手：READ_SCOPE 由 BFF 既有 `operator.read` 覆盖（审核员已核，T1.2 回填为确认项）。
- BFF 连接层（`apps/web/lib/gateway.ts`）帧协议已支持 `event` 帧分发，但目前只分发 `chat` 事件（gateway.ts:265），需扩展。
- 渠道会话可服务端过滤：`isValidWebSessionKey`（gateway.ts:370）不匹配渠道键，红线可执行。
- chat 终态事件（final/error/aborted）BFF 已订阅（`conn.onChatEvent`），可为 outcome 判定提供元数据源。

**T1 待掘取（本阶段第一项任务，阻塞后续设计定稿）**：
1. ~~scopes 是否足够~~ **已回填（审核员核验）：operator.read 足够，无需改握手。**
2. `sessions.changed` 的**sandbox 实抓**：事件名字面值、run 启动/结束各广播几次、reason 取值枚举、hasActiveRun 翻转时序（完成后是否保证有 false 广播、有无漏发场景）。
3. pong 探活可行性：douyin/xhs 服务端探活依赖 OFB_KEY 的机制（引擎哪条 skill/脚本实现）、可否经 execFile 从 BFF调用、调用成本与频率上限、失败时的降级表现。**结论决定 T3 选型（Q4）。**

## 3. 方案设计

### 3.1 T2 完成推送（按 §六 Q1/Q2/Q3/Q5/Q6 修订）

**BFF 侧**
- `lib/gateway.ts`：新增 `sessionChangeListeners` 集合 + `onSessionChange(listener)`；帧分发处（gateway.ts:265 旁）按实抓确认的事件名新增一路分发。载荷仅转发元数据字段。
- 新 SSE 路由 `GET /api/chat/sessions-events`（checkApiAuth）：两路合流转发——① sessions.changed 流（服务端过滤 `isValidWebSessionKey`，渠道会话永不出 BFF）；② **chat 终态元数据**（复用 `conn.onChatEvent`，仅当 `state ∈ {final, error, aborted}` 时剥离为 `{sessionKey, runId, state}` 三字段下发，供 Q2 outcome 判定，不带消息内容）。心跳/断线重连模式对齐现有 /api/chat/events。

**前端侧（Q1 修订：挂载点）**
- **NotificationBell 客户端岛挂根 `app/layout.tsx`**（审核员指出 chat 页不在 `(console)` 分组，挂 console layout 会导致发指令的页面反而看不到铃铛）——chat 页 + console 全覆盖。
- 数据源：localStorage 指令历史名册；sessions.changed 中 hasActiveRun **true→false 翻转沿** 且 sessionKey ∈ 名册 → 记一条未读。
- **Q2 修订：三态判定**。完成沿触发后，以该 sessionKey 最近一次 chat 终态元数据（error/aborted → 已出错；final → 已完成；若翻转沿先于终态到达则短暂等待/以 sessions.list 兜底）标注 outcome；指令记录渲染「进行中 / 已完成 / 已出错（红）」，铃铛条目带状态色。
- **Q3 修订：离线完成补痕**。重开页面时，名册条目若「完成 ts > notif-read 时间戳」→ 铃铛显示一次性**静默未读角标**（不弹窗不响），不堆积。
- **Q6 修订：打开即兜底**。页面加载时（不限铃铛打开）拉一次 /api/chat/sessions 校准名册 hasActiveRun；持续轮询仍限铃铛展开时（30s）。
- 交互：点铃铛展开下拉（最近 20 条：label/状态色/时间/进入会话/去观测页），点击导航 `/?session=…` 并清除该条未读；"全部已读"。
- **Q5 修订：跨标签已读同步**。`window.addEventListener('storage')` 监听 notif-read 变更，实时衰减其他标签的角标。
- 指令记录状态：名册 + 翻转沿 + 加载时 sessions.list 校准（同 Q6）。
- 已读持久化：localStorage `xiaobei-web:notif-read`（sessionKey+时间戳集合，上限 200）。

**边界**
- 只对指令名册内的 `agent:…:web:` 会话提醒；裸 `web:` 自由对话会话不弹铃铛。
- 多标签：notiv-read 数据共享 + storage 事件同步（Q5）；进行中的翻转沿通知本身不跨标签 live 传播（各标签独立 SSE 各自收到，无需同步）。

### 3.2 T3 登录态 pong 探活（按 §六 Q4 修订：双分支）

- BFF 新路由 `POST /api/logins/probe`（checkApiAuth），**按 T1.3 结论二选一**：
  - **分支 A（OFB_KEY 可外调）**：execFile 调引擎侧探活（模式对齐 lib/xiaobei-write.ts 白名单脚本约定）；/logins 预警平台可"进入页面自动探测"，第六状态呈现 + 委托重登联动。
  - **分支 B（仅 agent 路径可达）**：探活经 main agent 既有 skill 指令（/api/chat/command 全套白名单）；**只做手动"探测"按钮 + 显著引导文案**（本地"有效"卡片直接显示"本地判定有效，但服务端可能已失效，点此探测"），不承诺自动探测；诚实边界（盲区只关一半、探测=一轮 agent run 的成本）写入 DEVELOPMENT-LOG。
- 探测结果呈现为第六状态 **"服务端已失效"**（红色描边 + "本地 cookie 未过期，但平台侧已判定失效，需重新登录"），并同样挂"委托重新登录"按钮。
- 探测结果不落盘（每次实时探测），避免引入新的状态存储。

## 4. 红线（沿 Phase 4 §8，全部继续有效）

1. 新增路由（sessions-events / logins/probe）必须 checkApiAuth；401 语义与既有矩阵一致。
2. 铃铛/通知只携带会话级元数据（label/sessionKey/时间），**不携带消息内容**；渠道会话在 BFF 服务端过滤，永不出 BFF。
3. cookie 值零回显不变；探活结果只出状态布尔/错误信息。
4. openclaw.json 与真实 ~/.openclaw 零直改；探活若走引擎脚本，只读调用。
5. prompt 模板零进前端不变。

## 5. 任务拆解（按 §六.5 修订）

| # | 任务 | 产出 | 依赖 |
|---|------|------|------|
| T1 | 掘取：sessions.changed sandbox 实抓（时序/漏发）+ **T1.3 OFB_KEY 可达性（最优先，T3 选型唯一阻塞）** | DEVELOPMENT-LOG 掘取节 + §2 结论回填 | — |
| T2 | 完成推送：gateway.ts 扩展 + sessions-events SSE（两路合流、终态剥元数据）+ NotificationBell 挂根 layout + 指令记录三态 + Q3 静默补痕 + Q5 storage 同步 + Q6 打开即兜底 | 全链路 | T1 |
| T3 | pong 探活：probe 路由 + /logins 第六状态 + 委托重登联动（分支 A/B 按 T1.3） | 全链路 | T1 |
| T4 | 回归 + 日志 + 送审 | sandbox 全链路验证矩阵（含失败沿断言）；复审改动点 | T2, T3 |

## 6. 风险

| 风险 | 缓解 |
|------|------|
| sessions.changed 漏发/时序不符（完成沿丢失） | T1 sandbox 实抓先行；兜底 = 页面加载一次 sessions.list 校准（Q6）+ 铃铛展开时 30s 轮询 |
| 终态到达晚于完成沿（outcome 悬空） | 翻转沿后短暂等待终态（超时以 sessions.list + chat.history 兜底定态） |
| SSE 连接数增多（每标签一路） | 本机单用户场景可接受；沿用 EventSource 自动重连与心跳 |
| 探活脚本含敏感环境依赖（OFB_KEY） | T1 先查清依赖面；分支 B 诚实边界（不承诺自动探测）入日志 |
| 通知噪声（频繁 run 翻转） | 只计完成沿（false 沿）；同会话 5s 内去重 |

## 7. 验证方式

- T1 实抓证据表（事件名/载荷/次数/时序/漏发）落在 DEVELOPMENT-LOG
- T2：sandbox 发送长程指令 → 造完成沿（假 key 快速失败 = 失败沿）→ 断言：铃铛未读 +1 且状态色为"已出错"、指令记录三态正确、点击导航正确；**chat 页可见铃铛（Q1）**；渠道会话事件不进 SSE（负例）；重开页面静默补痕（Q3）；双标签已读同步（Q5）
- T3：夹具 + 探测按钮 → 第六状态渲染 + 重登联动；401 矩阵增量
- 审核员复审点：T2 挂载点 + 三态、T3 探活路径选择（§六.6）

## 8. 修订记录（2026-09-16 审核后，AUDIT-REPORT §六 Q1–Q6）

审核结论：技术地基（完成推送）对照引擎源码全量验证成立，红线到位；Q1/Q2 必改，Q3/Q4 视 T1 定夺，Q5/Q6 实施细节。主理人确认（2026-09-16）：Q1–Q6 全部纳入，Q2 采用"chat 终态元数据转发"（比审核建议的 chat.history 取末条更干净——不碰消息内容）。

| 审核项 | 修订 | 状态 |
|--------|------|------|
| Q1 [高] 铃铛挂载点反了 | NotificationBell 挂根 `app/layout.tsx`，chat 页 + console 全覆盖 | 已实施 |
| Q2 [高] 完成沿不分成败 | sessions-events SSE 增 chat 终态元数据转发（仅 {sessionKey, runId, state}）；指令记录三态「进行中/已完成/已出错」；铃铛条目状态色 | 已实施 |
| Q3 [中] 离线完成无痕迹 | 重开页面按 notif-read vs 完成 ts 做一次性静默角标补齐 | 已实施 |
| Q4 [中] 探活盲区诚实边界 | T1.3 定分支：可外调→自动探测预警平台；仅 agent 路径→手动探测 + 显著引导文案，不承诺自动 | 按 T1.3 实施 |
| Q5 [低] 多标签已读不同步 | `storage` 事件监听同步已读/未读角标 | 已实施 |
| Q6 [低] 兜底轮询静默 | 页面加载即 sessions.list 校准一次（打开即补）；持续轮询限铃铛展开 | 已实施 |
| §六.5 T1 回填 | T1.2 scopes 已核（operator.read 足够）降为确认项；T1.3 OFB_KEY 升为最优先 | 已回填 §2 |
