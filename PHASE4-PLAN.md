# Phase 4 计划：能力覆盖（快捷指令库 + 登录态监控）

> 日期：2026-09-15。状态：**待第三方审核**（审核通过后实施）。
> 前置：Phase 1–3 已完成并过审（DEVELOPMENT-LOG.md）；本机生产部署完成（XIAOBEI-WEB-DEPLOY-LOG.md）。
> 与原 build plan（docs/2026-09-08_xiaobei-web-console-build-plan.md，在 xiaobei 仓）的关系：原计划 Phase 4 = SaaS 多租户，顺延为 Phase 5。

## 0. 决策链总览（本计划的推导路径）

```
xiaobei 能力图谱（§1，事实）
  ×  web 控制台功能现状（§2，事实）
  →  能力覆盖矩阵（§3，对比结论：三类缺口）
  →  缺口分析与优先级排序（§4，推导）
  →  本阶段范围（§5 目标/非目标）
  →  技术前提掘取（§6，可行性证据）
  →  方案设计（§7）→ 红线（§8）→ 任务拆解（§9）→ 风险（§10）
```

审核建议从 §1–§4 查起：事实基础是否准确、覆盖判定是否成立、优先级推导是否有跳步。

---

## 1. 事实：xiaobei 能力图谱

来源：产品仓 `/Users/harvey/Documents/Qoder/xiaobei` 的 README、docs/、crews/ 各 crew 的 AGENTS/IDENTITY/SKILL frontmatter、crews/*/openclaw_setting_sample.json（2026-09-15 全面掘取，证据路径随行）。

| # | 能力域 | 具体能力 | 主要证据 |
|---|--------|---------|---------|
| 1 | 对话与消息 | 微信/飞书/awada 多渠道入口对话；gateway WS chat.send 流式 | README；build-plan §4.1 |
| 2 | 渠道接入 | weixin 扫码绑定；awada 企业微信 relay；飞书/企微工作渠道绑定（work-channel-binding）；邮件代发（email-ops） | docs/AWADA-CLIENT-TRANSPORT.md；it-engineer/skills |
| 3 | 平台运营与发布 | 五大专家包 expert-wx-mp/xhs/douyin/wx-channel/twitter（起号→对标→生产→改稿→复盘全流程）；微博/知乎/朋友圈/闲鱼配套 | crews/main/skills/expert-*；main/TOOLS.md |
| 4 | 内容生产 | video-producer 14 阶段端到端视频；manim/design/collage；aigc-video-gen（百炼/Seedance/MiniMax）、TTS、BGM、video-review 自检；追爆拆解、轻剪辑 | crews/content-producer/skills；skills/aigc-* |
| 5 | 数据回流与复盘 | published-track SQLite 发布+互动指标；凌晨心跳取数复盘；content-calibrator DNA 评估回写；内容 DNA 库 16+ 维 | crews/main/skills/published-track；docs/expert-pack-dna-architecture.md |
| 6 | 情报与调研 | smart-search 18 类信源零 key；wx-mp-hunter 公众号抓取；market-research；rss-reader | skills/smart-search；expert-bd/tools |
| 7 | BD/投融资 | expert-bd（找客户/评论区截流/商业情报/竞对监控/每日简报）；expert-ir 投资人状态机+项目申报；pitch-deck；council 四方辩论 | crews/main/skills/expert-bd、expert-ir |
| 8 | 客户管理与销售客服 | sales-cs crew（绑 awada，默认停用）；customer-db 商业状态机；demo-send/exp-invite/proactive-send | crews/sales-cs/skills；docs/sales-cs-bootstrap.md |
| 9 | 定时任务与自动化 | cron isolated session；heartbeat 周期巡检；complex-task 长程编排；subagent 自主协作 | openclaw_setting_sample.json；README |
| 10 | 浏览器与媒体 | camoufox 反检测浏览器+持久 session；browser-guide/web-form-fill；login-manager 5 平台登录+中央 cookie | patches/camoufox-cli；docs/platform-login-and-browser-spec.md |
| 11 | 记忆与会话 | 8 个 bootstrap 文件注入；MEMORY.md 长期记忆；memorySearch；凌晨 dream | docs/workspace-bootstrap-files.md |
| 12 | 配置与运维 | it-engineer 巡检 crew；openclaw.json 全配置面（providers/models/skills/hooks/gateway）；camoufox-guard 防 OOM | crews/it-engineer |
| 13 | Crew 组织管理 | crew 启停 SOP；_template 脚手架；sales-cs-manager 启用流程 | crews/main/AGENTS.md |

**产品主流程**：用户在微信对小贝说目标 → main 路由专家包 → DNA 对标复刻+内容生产（视频委托 content-producer）→ camoufox 发布并记 published-track → 凌晨心跳取数、calibrator 评估回写 DNA 自进化 → expert-bd 评论区截流/情报获客 → 线索转 sales-cs 经 awada 转化 → it-engineer 保系统 7×24；expert-ir/council/pitch-deck 支撑融资线。

## 2. 事实：web 控制台功能现状

来源：`/Users/harvey/Documents/Qoder/projects/xiaobei-web/apps/web` 全量盘点（2026-09-15）。13 个页面全部是实功能（无占位页），18 个 API。

**页面**：`/` 聊天（SSE 流式/中止/历史/幂等重试）；`/publish` 发布记录+写回表单；`/dna`+详情；`/calibration` 只读；`/bd-ir` 五区块+IR 状态推进；`/customers` 档案+跟进写回；`/videos` 里程碑推断只读；`/tasks` /`/sessions` /`/cron` /`/media` 引擎观测只读；`/config` 配置摘要 + 4 运维面板（channel 绑定 GUI、crew 启停、provider 轮换、cron 运维）+ gateway 重启。

**API**：chat×4（events/send/abort/history）；config×6；cron×2；domain 写回×4。全部挂 checkApiAuth（loopback + 共享令牌）。

**当前定位**：聊天入口 + 只读驾驶舱 + 低风险运维/写回。

## 3. 对比结论：能力覆盖矩阵

| 能力域 | web 现状 | 覆盖 | 缺口性质 |
|--------|---------|------|---------|
| 对话 | 聊天页全功能（独立 web 会话） | ✅ | — |
| 渠道接入 | 绑定 GUI 仅 awada/feishu 两模板 | ◐ | weixin 换绑、work-channel、email 无 web 面 |
| 内容生产 | /videos 只读里程碑 | ◐ | **观测有、发起无** |
| 平台发布 | /publish 只看记录 | ◐ | **观测有、执行无** |
| 数据回流复盘 | 发布记录+互动补录、DNA 全览、校准只读 | ✅ | 校准触发本身留 agent（合理） |
| 情报调研 | 无专门界面 | ❌ | 只能聊天间接用 |
| BD/投融资 | 五区块视图+IR 状态写回 | ✅ | 获客/截流执行留 agent |
| 客户管理 | 档案+跟进写回、crew 启停 | ✅ | 主动触达执行留 agent |
| 定时任务 | 运维四操作（run/toggle/remove/list） | ◐ | **新建/改期不开放**（P3-E 评估否决表单方案） |
| 浏览器与登录 | /media 仅文件计数 | ❌ | **登录态完全不可见**（风控要害） |
| 记忆与会话 | /sessions 只读索引 | ◐ | 记忆管理无 web 面 |
| 配置运维 | 4 面板+重启 | ✅ | provider 新建/hooks/skills 装载未开放（低频，合理） |
| 多租户 SaaS | 未启动 | ❌ | 原计划 Phase 4，license-gated（授权已于 2026-09-15 取得） |

## 4. 缺口分析与优先级推导

**缺口分三类**：

1. **执行类能力"看不见但可发起"**（内容生产/发布/调研/BD 执行/定时任务创建）：这些能力的本体在 agent 侧且运转良好（专家包+DNA+camoufox 是产品核心资产）。在 web 重写它们既不可行（浏览器做不了反检测浏览器/签名）也不应该（agent 对话是产品主入口）。**最高杠杆的补法是给 web 加"发起入口"**：把专家包标准工作流做成一键委托指令，复用既有 chat.send 通道——一个入口覆盖全部执行类缺口。
2. **真正该新建的 web 面**：登录态监控最突出——登录 cookie 过期=发布链路断，属风控要害，且数据基础现成（§6B）；其余如媒体预览价值较低。
3. **Phase 5 SaaS**：授权已到位，但多租户依赖单租户形态先稳定，且是独立工程（auth/隔离/品牌化），不宜与本阶段混合。

**优先级结论**：Phase 4 = 快捷指令库（补缺口 1）+ 登录态监控（补缺口 2 最痛项）；SaaS 顺延 Phase 5；媒体预览/记忆管理/渠道模板扩充进 backlog。此排序的可检验依据：缺口 1 覆盖 5 个能力域，缺口 2 覆盖 1 个但属"断链风险"，backlog 项均无断链风险。

## 5. 本阶段范围

**目标**：
1. **快捷指令库**：专家包/视频生产/BD/IR/定时任务创建等做成 web 一键委托——web 服务端组装规范化指令消息发给对应 agent，执行与产物全部在 agent 侧，既有 dashboard 页观测
2. **登录态监控**：平台登录 cookie 状态只读可视化 + 本地过期预警（douyin/kuaishou/bilibili/xhs-publish/xhs-browse + 自管 wx_mp）

**非目标**（防蔓延）：
- 不在 web 实现任何执行逻辑
- 不做 cron 新建/改期表单（P3-E 否决；折中：委托 agent 创建）
- 不做多租户/auth 体系（Phase 5）
- 不做媒体预览（backlog）

## 6. 技术前提（已掘取验证，2026-09-15）

**A. 指令路由——零网关改动**：
- chat.send 不走 bindings；agent 由 sessionKey 决定：`agent:<agentId>:<rest>` 格式直达该 agent（`src/sessions/session-key-utils.ts:262-282`、`src/gateway/session-store-key.ts:104-110`）；`ChatSendParamsSchema` 有可选 `agentId`（`packages/gateway-protocol/src/schema/logs-chat.ts:79-99`），且校验"agentId 必须与 sessionKey 内嵌一致"（`src/gateway/server-methods/chat.ts:690-723`）
- 硬约束：目标 agent 必须已在 agents.list（否则 "Agent no longer exists"）；content-producer 已启用可直接用
- 注意：`agent:x:web:…` 与现有 `web:<uuid>` 是不同会话空间，历史不互通——聊天页需支持多会话列表

**B. 登录态数据基础完备**：
- 存储：`~/.openclaw/logins/<platform>.json`（`{platform, cookies:[…含 expires epoch 秒], updated_at}`）+ `<platform>.ua.json`（`crews/main/skills/login-manager/SKILL.md:18-23`）
- 现成探活 CLI：`published-track/scripts/check-login.ts --platform <p> --no-ping`（零网络离线、JSON 输出、exit 0/2/1）
- 已知误差：`expires<=0` 的会话 cookie 无法本地预警；服务端提前失效需 pong 探活（v2，xhs/douyin pong 依赖 OFB_KEY）
- 本机 `logins/` 当前为空 → 上线初期展示"未登录/无数据"是正常态

## 7. 设计

### 7.1 快捷指令库

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
- 系统 ×2：创建定时任务（自然语言描述→agent 调 cron tool）、诊断系统问题（→it-engineer，是否开放见 §10.5）

**交互流**：指令卡（按分组）→ 填参数 → prompt 预览（服务端渲染回显）→ 发送 → 复用现有 SSE 流式展示 → 产物在既有 dashboard 页观测

**关键实现原则**：
- **prompt 组装只在 BFF**：浏览器只上送 `{commandId, params}`，模板永不进前端；参数做长度/字符集白名单
- 幂等键沿用浏览器生成透传机制（F2 修复模式）
- sessionKey：`agent:<targetAgentId>:web:<uuid>`，`agentId` 参数显式声明

### 7.2 登录态监控

- 数据层 `lib/xiaobei-logins.ts`：只读 `logins/*.json`（updated_at / cookie name 存在性 / expires）+ `execFile` 调 check-login.ts `--no-ping`（复用域写回层 execFile 白名单模式，此处只读命令）
- API `GET /api/logins`：checkApiAuth 保护；只返回**元数据**（平台、updated_at、最近过期时间、状态枚举）
- 页面 `/logins`：平台卡片（有效/临期≤7天/已过期/未登录/无数据）+ 页顶预警汇总条
- 预警只做本地 Tier1 判定（expires 字段），不做 pong 网络探活

## 8. 红线与安全设计（请审核重点确认）

| 红线 | 本阶段设计 |
|------|-----------|
| 零直改 openclaw.json | 不变（本阶段无任何配置写） |
| 真实 ~/.openclaw 零写入 | 不变：logins/ 只读；指令只经 chat.send 进 agent 会话 |
| 鉴权 | 新路由（/api/chat/command、/api/logins）全挂 checkApiAuth |
| **cookie 值绝不回显**（新增） | API 与 UI 均只出元数据（name 存在性/expires/updated_at），绝不返回 cookie value |
| **sales-cs 不受 web 直发指令**（新增） | sales-cs 是对外 crew，targetAgentId 白名单={main, content-producer, it-engineer}，服务端校验 |
| prompt 注入面 | 参数白名单校验后嵌入模板；模板为仓内静态定义（进 git 可审）；不提供自由 prompt 直通 |
| 不克隆内置 UI | 指令卡/登录卡片均为原创样式 |

## 9. 任务拆解

| # | 任务 | 交付物 | 验证标准 |
|---|------|--------|---------|
| T1 | 路由实证：sandbox 网关验证 `agent:content-producer:web:<uuid>` + agentId 参数真实行为（含目标未启用的报错路径）；会话列表读取方式掘取（多会话 UI 数据源） | 掘取结论入 DEVELOPMENT-LOG | sandbox 实测记录 + 证据 |
| T2 | 指令目录 + BFF：command-catalog.ts + POST /api/chat/command（模板渲染/参数白名单/幂等键/sessionKey 生成） | lib + route | tsc/eslint 零；非法 commandId 400；无令牌 401；渲染快照 |
| T3 | 聊天页多会话 + 指令入口 UI：会话列表/切换/指令卡/参数表单/prompt 预览/发送 | page + components | DOM 断言；sandbox 真实发送 content-producer 指令全链路 |
| T4 | 登录态数据层 + API：xiaobei-logins.ts + GET /api/logins | lib + route | 空目录空态 ✅；sandbox 夹具（OPENCLAW_STATE_DIR 指临时目录造 4 状态夹具）✅；无令牌 401 |
| T5 | /logins 页 UI：平台卡片 + 预警汇总 + 五状态渲染 | page | DOM 断言四状态 |
| T6 | 全量回归 + 日志：既有矩阵重跑（401/200/400）+ tsc/lint + DEVELOPMENT-LOG Phase 4 节 | 日志 | 矩阵全绿 |
| T7 | 提交 + 送审 | commit | 审核通过 |

依赖：T1→T2/T3；T4→T5；T2/T3 与 T4/T5 两线可并行。

## 10. 风险与已知限制（预设，实施后补全）

1. agent 前缀会话与 `web:` 会话空间不互通——聊天页历史列表需合并展示两类会话（T1 掘取会话枚举方式）
2. 指令模板质量决定委托效果——v1 从 SKILL.md 标准触发语改编，改模板=改代码（审核可见）
3. cookie 预警两类误差（§6B）；pong 网络探活留 v2
4. logins/ 当前为空——上线初期只有"无数据"空态，属正常
5. **开放项（待审核意见定夺）**：it-engineer 产品约定"不直接对用户"，"诊断系统问题"指令是否开放待定；若否决则指令目标白名单收紧为 {main, content-producer}

## 11. 给审核员的关注点

1. **决策链**：§1 能力图谱与 §2 现状盘点的事实是否准确；§3 矩阵的覆盖判定（尤其 ✅/◐/❌ 三档）是否成立；§4 优先级推导是否有跳步
2. §8 两条新增红线（cookie 不回显、sales-cs 隔离）是否充分，有无遗漏面
3. prompt 模板进 git 的可审形态（静态 TS 常量 vs JSON）
4. 指令目录 v1 清单取舍（§7.1）是否符合产品优先级
5. 多会话 UI 对既有 chat 页的改造边界（回归风险）
