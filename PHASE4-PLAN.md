# Phase 4 计划：能力覆盖（快捷指令库 + 登录态监控）

> 日期：2026-09-15。状态：**待第三方审核**（审核通过后实施）。
> 前置：Phase 1–3 已完成并过审；本机生产部署完成（XIAOBEI-WEB-DEPLOY-LOG.md）。
> 与原 build plan 的关系：原计划 Phase 4 = SaaS 多租户，顺延为 Phase 5；本阶段依据 2026-09-15 能力覆盖矩阵（web 已覆盖"观测+运维+写回"，执行类能力缺 web 入口）。

## 1. 目标与非目标

**目标**：
1. **快捷指令库**：把 agent 侧执行能力（五大平台专家包、视频生产、BD/IR、定时任务创建等）做成 web 一键委托——web 生成规范化的指令消息发给对应 agent，执行与产物仍全部在 agent 侧，dashboard 页面已有对应观测视图
2. **登录态监控**：平台登录 cookie 状态只读可视化 + 本地过期预警（覆盖 login-manager 管理的 douyin/kuaishou/bilibili/xhs-publish/xhs-browse + 自管 wx_mp）

**非目标**（写入日志防蔓延）：
- 不在 web 实现任何执行逻辑（发布、生产、搜索全部由 agent 执行）
- 不做 cron 新建/改期表单（P3-E 已评估否决；本阶段折中：委托 agent 自然语言创建）
- 不做多租户/auth 体系（Phase 5）
- 不做媒体文件预览（backlog）

## 2. 技术前提（已掘取验证，2026-09-15）

**A. 指令路由——零网关改动**：
- chat.send 不走 bindings；agent 由 sessionKey 决定：`agent:<agentId>:<rest>` 格式直达该 agent（`src/sessions/session-key-utils.ts:262-282`、`src/gateway/session-store-key.ts:104-110`）；`ChatSendParamsSchema` 有可选 `agentId`（`packages/gateway-protocol/src/schema/logs-chat.ts:79-99`），且校验"agentId 必须与 sessionKey 内嵌一致"（`src/gateway/server-methods/chat.ts:690-723`）
- 硬约束：目标 agent 必须已在 agents.list（否则 "Agent no longer exists"）；content-producer 已启用可直接用
- 注意：`agent:x:web:…` 与现有 `web:<uuid>` 是不同会话空间，历史不互通——聊天页需支持多会话列表

**B. 登录态数据基础完备**：
- 存储：`~/.openclaw/logins/<platform>.json`（`{platform, cookies:[…含 expires epoch 秒], updated_at}`）+ `<platform>.ua.json`（`crews/main/skills/login-manager/SKILL.md:18-23`）
- 现成探活 CLI：`published-track/scripts/check-login.ts --platform <p> --no-ping`（零网络离线、JSON 输出、exit 0/2/1）
- 已知误差（须记入已知限制）：`expires<=0` 的会话 cookie 无法本地预警；服务端提前失效需 pong 探活（v2 再做，xhs/douyin pong 依赖 OFB_KEY）
- 本机 `logins/` 当前为空 → 上线初期展示"未登录/无数据"是正常态

## 3. 设计

### 3.1 快捷指令库

**数据形态**：静态指令目录 `lib/command-catalog.ts`（仓内常量，进 git 可审）。每条指令：

```ts
{
  id: string,
  group: "平台运营" | "内容生产" | "BD" | "IR" | "系统",
  label: string,
  description: string,
  targetAgentId: "main" | "content-producer" | "it-engineer",
  promptTemplate: string,   // 服务端渲染，含 {{param}} 占位符
  params: Array<{ key, label, type: "text" | "choice", required, options? }>,
}
```

**v1 目录（约 12–16 条，源自 main AGENTS.md 任务路由表 + 各 SKILL.md 标准触发语）**：
- 平台运营 ×5：公众号/小红书/抖音/视频号/推特——"对标复刻生产"组合指令（参数：目标、素材/链接、平台要求）
- 内容生产 ×3：完整视频委托（→content-producer：主题/时长/风格）、manim 讲解动画、海报/封面生成
- BD ×2：找客户与评论区截流（平台+品类）、商业情报简报
- IR ×1：项目申报 / 投资人跟进
- 系统 ×2：创建定时任务（自然语言描述→agent 调 cron tool）、诊断系统问题（→it-engineer）

**交互流**：指令卡（按分组）→ 填参数 → prompt 预览（服务端渲染结果回显）→ 发送 → 复用现有 SSE 流式展示回复 → 产物在既有 dashboard 页观测（发布记录/视频页/cron 页）

**关键实现原则**：
- **prompt 组装只在 BFF**：浏览器只上送 `{commandId, params}`，模板永不进前端；参数做长度/字符集白名单
- 幂等键沿用浏览器生成透传机制（F2 修复模式）
- sessionKey：`agent:<targetAgentId>:web:<uuid>`，`agentId` 参数显式声明（与掘取结论一致）

### 3.2 登录态监控

- 数据层 `lib/xiaobei-logins.ts`：只读 `logins/*.json`（取 updated_at / 各 cookie 的 name 存在性与 expires）+ `execFile` 调 check-login.ts `--no-ping`（复用域写回层的 execFile 白名单模式，此处只读命令）
- API `GET /api/logins`：checkApiAuth 保护；返回**元数据**——平台、updated_at、最近过期时间、状态枚举
- 页面 `/logins`：平台卡片（状态：有效/临期≤7天/已过期/未登录/无数据）+ 页顶汇总条（N 平台临期/过期预警）
- 预警只做本地 Tier1 判定（expires 字段），不做 pong 网络探活

## 4. 红线与安全设计（请审核重点确认）

| 红线 | 本阶段设计 |
|------|-----------|
| 零直改 openclaw.json | 不变（本阶段无任何配置写） |
| 真实 ~/.openclaw 零写入 | 不变：logins/ 只读；指令只经 chat.send 进 agent 会话 |
| 鉴权 | 新路由（/api/chat/command、/api/logins）全挂 checkApiAuth |
| **cookie 值绝不回显**（新增） | /api/logins 只回显元数据（name 存在性/expires/updated_at），绝不返回 cookie value；UI 同样不显示 |
| **sales-cs 不受 web 直发指令**（新增） | sales-cs 是对外 crew，v1 指令目录 targetAgentId 白名单={main, content-producer, it-engineer}，服务端校验 |
| prompt 注入面 | 用户参数嵌入模板前做白名单校验；模板由仓内静态定义（进 git 可审）；不提供自由 prompt 直通 |
| 不克隆内置 UI | 指令卡/登录卡片均为原创样式 |

## 5. 任务拆解

| # | 任务 | 交付物 | 验证标准 |
|---|------|--------|---------|
| T1 | 路由实证：sandbox 网关验证 `agent:content-producer:web:<uuid>` + agentId 参数真实行为（含目标未启用的报错路径）；会话列表读取方式掘取（多会话 UI 数据源） | 掘取结论入 DEVELOPMENT-LOG | sandbox 实测记录 + 证据 |
| T2 | 指令目录 + BFF：command-catalog.ts + POST /api/chat/command（模板渲染/参数白名单/幂等键/sessionKey 生成） | lib + route | tsc/eslint 零；非法 commandId 400；无令牌 401；渲染快照 |
| T3 | 聊天页多会话 + 指令入口 UI：会话列表/切换/指令卡/参数表单/prompt 预览/发送 | page + components | DOM 断言；sandbox 真实发送 content-producer 指令全链路 |
| T4 | 登录态数据层 + API：xiaobei-logins.ts + GET /api/logins | lib + route | 空目录空态 ✅；sandbox 夹具（OPENCLAW_STATE_DIR 指向临时目录造 4 状态夹具）✅；无令牌 401 |
| T5 | /logins 页 UI：平台卡片 + 预警汇总 + 五状态渲染 | page | DOM 断言四状态 |
| T6 | 全量回归 + 日志：既有矩阵重跑（401/200/400）+ tsc/lint + DEVELOPMENT-LOG Phase 4 节（含掘取/验证证据/已知限制） | 日志 | 矩阵全绿 |
| T7 | 提交 + 送审 | commit | 审核通过 |

依赖：T1→T2/T3；T4→T5；T2/T3 与 T4/T5 两线可并行。

## 6. 风险与已知限制（预设，实施后补全）

1. agent 前缀会话与 `web:` 会话空间不互通——聊天页历史列表需合并展示两类会话（T1 掘取会话枚举方式）
2. 指令模板质量决定委托效果——v1 从 SKILL.md 标准触发语改编，属可迭代内容（改模板=改代码，审核可见）
3. cookie 预警两类误差（见 §2B）；pong 网络探活留 v2
4. logins/ 当前为空——上线初期页面只有"无数据"空态，属正常
5. it-engineer 指令会话：it-engineer 在 agents.list 中但产品约定"不直接对用户"——v1 是否开放"诊断系统问题"指令，待审核意见定夺

## 7. 给审核员的关注点

1. §4 新增两条红线（cookie 不回显、sales-cs 隔离）是否充分，是否有遗漏面
2. prompt 模板进 git 的可审形态是否足够（静态 TS 常量 vs JSON）
3. 指令目录 v1 清单的取舍（§3.1）是否符合产品优先级
4. 多会话 UI 对既有 chat 页的改造边界（是否引入回归风险）
