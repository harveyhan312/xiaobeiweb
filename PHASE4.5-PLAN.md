# Phase 4.5 计划：体验闭环（完成推送 + 登录态探活）

> 日期：2026-09-16。状态：**待审**。
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

**已证实（Phase 4 T1，DEVELOPMENT-LOG 2026-09-15 节）**：
- gateway 广播 `sessions.changed` 事件（引擎 `src/gateway/…/session-change-event.ts`），载荷 `{sessionKey, agentId, reason, hasActiveRun, activeRunIds, ts}`——完成推送的事件源成立。
- BFF 连接层（`apps/web/lib/gateway.ts`）帧协议已支持 `event` 帧分发，但目前只分发 `chat` 事件（gateway.ts:265），需扩展。

**T1 待掘取（本阶段第一项任务，阻塞后续设计定稿）**：
1. `sessions.changed` 的**事件名字面值与确切载荷**（引引擎源码 + sandbox 实抓）：run 启动/结束各广播几次、reason 取值枚举、hasActiveRun 翻转时序（完成后是否保证有 hasActiveRun=false 广播）。
2. BFF 订阅面：现有 connect scopes（operator.read/write/admin）是否足够接收该事件，无需改握手。
3. pong 探活可行性：douyin/xhs 服务端探活依赖 OFB_KEY 的机制（引擎哪条 skill/脚本实现）、可否经 execFile 从 BFF调用、调用成本与频率上限、失败时的降级表现。**结论决定 T3 是"手动按钮"还是"手动+定时"。**
4. 完成沿判定的兜底：若 `sessions.changed` 在 sandbox 实抓中存在漏发场景，是否可用 `sessions.list` 的 `hasActiveRun` 轮询兜底（现有 /api/chat/sessions 已返回该字段）。

## 3. 方案设计

### 3.1 T2 完成推送

**BFF 侧**
- `lib/gateway.ts`：新增 `sessionChangeListeners` 集合 + `onSessionChange(listener)`；帧分发处（gateway.ts:265旁）按实抓确认的事件名新增一路分发。载荷仅转发元数据字段。
- 新 SSE 路由 `GET /api/chat/sessions-events`（checkApiAuth）：转发 sessions.changed 流，**服务端过滤** `isValidWebSessionKey(payload.sessionKey)`——渠道会话（微信/飞书/awada）永不进浏览器。心跳/断线重连模式对齐现有 /api/chat/events。

**前端侧**
- `console/layout.tsx` 挂载 **NotificationBell 客户端岛**（顶栏铃铛 + 未读数徽标），全页面可见（不止 chat 页）。
- 数据源：localStorage 指令历史（`xiaobei-web:command-history`，Phase 4 已有）作为"哪些会话是我的指令"的名册；sessions.changed 中 hasActiveRun **true→false 翻转沿** 且 sessionKey ∈ 名册 → 记一条未读（label 从名册取，无则显示 agent 名）。
- 初始状态校准：页面加载时拉 /api/chat/sessions，对名册中 hasActiveRun=false 且无对应已读记录的条目不做补弹（避免每次打开页面堆积旧通知）；只从订阅建立后的翻转沿开始计。
- 交互：点铃铛展开下拉（最近 20 条：label/时间/进入会话/去观测页），点击即导航 `/?session=…`（Phase 4 深链已支持）并清除该条未读；"全部已读"按钮。
- 指令记录状态：名册条目 + 实时翻转沿 → 指令记录 Tab 渲染"进行中"（绿点脉动）/“已完成”；打开时以 sessions.list 的 hasActiveRun 校准一次。
- 已读持久化：localStorage `xiaobei-web:notif-read`（存最近已读的 sessionKey+时间戳集合，上限 200，防膨胀）。

**边界**
- 只对指令名册内的 `agent:…:web:` 会话提醒；裸 `web:` 自由对话会话不弹铃铛（用户本人在场对话）。
- 多标签页：每个标签独立 SSE，通知不跨页同步（v1 接受，单用户本机使用）。

### 3.2 T3 登录态 pong 探活

- BFF 新路由 `POST /api/logins/probe`（checkApiAuth）：按 T1 结论调用引擎侧探活（execFile 模式对齐 lib/xiaobei-write.ts 的白名单脚本约定；若 OFB_KEY 只在引擎进程环境可得，则改为调用 main agent 的既有 skill 指令，经 /api/chat/command 全套白名单——**以 T1 结论二选一**）。
- /logins 页：平台卡增"探测"按钮（手动触发；若 T1 证实低成本低风险，加可选的"进入页面自动探测预警平台"）；探测结果呈现为第六状态 **"服务端已失效"**（红色描边 + 与本地状态的差异说明文案"本地 cookie 未过期，但平台侧已判定失效，需重新登录"），并同样挂"委托重新登录"按钮。
- 探测结果不落盘（每次实时探测），避免引入新的状态存储。

## 4. 红线（沿 Phase 4 §8，全部继续有效）

1. 新增路由（sessions-events / logins/probe）必须 checkApiAuth；401 语义与既有矩阵一致。
2. 铃铛/通知只携带会话级元数据（label/sessionKey/时间），**不携带消息内容**；渠道会话在 BFF 服务端过滤，永不出 BFF。
3. cookie 值零回显不变；探活结果只出状态布尔/错误信息。
4. openclaw.json 与真实 ~/.openclaw 零直改；探活若走引擎脚本，只读调用。
5. prompt 模板零进前端不变。

## 5. 任务拆解

| # | 任务 | 产出 | 依赖 |
|---|------|------|------|
| T1 | 掘取：sessions.changed 实抓（sandbox）+ pong 机制 + scopes 核实 | DEVELOPMENT-LOG 掘取节 + §2 结论回填 | — |
| T2 | 完成推送：gateway.ts 扩展 + sessions-events SSE + NotificationBell + 指令记录状态 | 全链路 | T1 |
| T3 | pong 探活：probe 路由 + /logins 第六状态 + 委托重登联动 | 全链路 | T1 |
| T4 | 回归 + 日志 + 送审 | sandbox 全链路验证矩阵；复审改动点 | T2, T3 |

## 6. 风险

| 风险 | 缓解 |
|------|------|
| sessions.changed 漏发/时序不符（完成沿丢失） | T1 sandbox 实抓先行；兜底方案 = 名册会话 hasActiveRun 轮询（30s，仅铃铛打开时） |
| SSE 连接数增多（每标签一路） | 本机单用户场景可接受；沿用 EventSource 自动重连与心跳 |
| 探活脚本含敏感环境依赖（OFB_KEY） | T1 先查清依赖面；不可安全外调则降级为 agent 指令路径（白名单不变） |
| 通知噪声（频繁 run 翻转） | 只计完成沿（false 沿）；同会话 5s 内去重 |

## 7. 验证方式

- T1 实抓证据表（事件名/载荷/次数/时序）落在 DEVELOPMENT-LOG
- T2：sandbox 发送长程指令 → 造完成沿（abort 或假 key 快速失败）→ 断言铃铛未读 +1、指令记录状态翻转、点击导航正确；渠道会话事件不进 SSE（负例）
- T3：夹具 + 探测按钮 → 第六状态渲染 + 重登联动；401 矩阵增量
- 审核员复审点：§2 掘取结论、§3.1 通知元数据边界、§3.2 探活路径选择、§4 红线
