# openclaw gateway chat 协议（实测源码固化）

> 2026-09-14 从本机 `~/xiaobei/openclaw/`（引擎 v2026.7.1 / commit 0790d9f5）TS 源码逐行提取，非猜测。
> 用途：xiaobei-web 聊天页 WS 直连 gateway。协议版本 **PROTOCOL_VERSION = 4**（`MIN_CLIENT_PROTOCOL_VERSION = 4`）。

## 0. 依据文件

| 内容 | 源文件 |
|------|--------|
| 帧封套 / ConnectParams / HelloOk / ErrorShape | `packages/gateway-protocol/src/schema/frames.ts` |
| chat.* 方法参数与事件 schema | `packages/gateway-protocol/src/schema/logs-chat.ts` |
| 错误码 | `packages/gateway-protocol/src/schema/error-codes.ts` |
| client id / mode 常量 | `packages/gateway-protocol/src/client-info.ts` |
| 客户端握手实现 | `packages/gateway-client/src/client.ts`（参考实现，勿直接依赖其内部） |
| 服务端挑战帧 | `src/gateway/server/ws-connection.ts:395-400` |
| chat.* handler / ack / dedupe | `src/gateway/server-methods/chat.ts`（chat.send@3699, history@3324, abort@3437, inject@5910） |
| 方法权限总表 | `src/gateway/methods/core-descriptors.ts` |
| 事件名清单 | `src/gateway/server-methods-list.ts` GATEWAY_EVENTS |

## 1. 传输与鉴权

- 地址：`ws://127.0.0.1:18789`（`config.gateway.port`；xiaobei 默认 `gateway.bind:"loopback"` 只监听本机）。
- **明文 ws:// 仅允许 loopback/私网/Tailscale**：客户端侧安全策略会拒绝公网明文连接（`isSecureWebSocketUrl`）；我们只连 127.0.0.1，无此问题。
- WS 帧上限：客户端按 **25MB maxPayload** 配置；服务器实际值以握手响应 `payload.policy.maxPayload` 为准。
- **token 不走 URL query，走 connect 帧**：`params.auth.token` 携带 gateway token（即 `~/.openclaw/.env` 中 gateway.auth.token 对应值）。URL 里带 token 的做法是被日志脱敏逻辑视为敏感的反模式。
- 本地 token 认证时 `device`（设备密钥签名）可选——`ConnectParamsSchema.device` 是 optional，token 模式无需设备配对（远程/非 token 场景才涉及 `openclaw devices approve`）。
- 心跳：服务器周期广播 `tick` 事件（默认 30s，以 `hello-ok.policy.tickIntervalMs` 为准）；客户端超 30s 无 tick 判定假死。

## 2. 连接握手（三步，全部文本帧 JSON）

```
① 服务器 → 客户端（socket open 后立即，ws-connection.ts:395）
{ "type":"event", "event":"connect.challenge", "payload":{ "nonce":"<uuid>", "ts":1731... } }

② 客户端 → 服务器（method 固定 "connect"）
{ "type":"req", "id":"<任意唯一串>", "method":"connect", "params":{
    "minProtocol": 4, "maxProtocol": 4,
    "client": {
      "id": "gateway-client",          // 见 §7 客户端身份
      "displayName": "xiaobei-web",    // 可选，诊断用
      "version": "0.1.0",
      "platform": "darwin",
      "mode": "backend"                // 见 §7
    },
    "role": "operator",
    "auth": { "token": "<OPENCLAW_GATEWAY_TOKEN>" }
}}

③ 服务器 → 客户端
{ "type":"res", "id":"<同②>", "ok":true, "payload":{ "type":"hello-ok", ... } }
```

`hello-ok` payload 关键字段：

```jsonc
{
  "type": "hello-ok",
  "protocol": 4,                       // 协商后协议版本
  "server": { "version": "...", "connId": "..." },
  "features": {
    "methods": ["chat.send", "chat.history", "..."],   // 支持的方法清单，运行时以此为准
    "events": ["connect.challenge", "chat", "agent", "..."],
    "capabilities": ["chat-send-routing-contract", "..."]  // 可选
  },
  "snapshot": { ... },                 // 初始状态快照
  "auth": { "role": "operator", "scopes": ["operator.read","operator.write", ...] },
  "policy": { "maxPayload": ..., "maxBufferedBytes": ..., "tickIntervalMs": ... }
}
```

握手失败时 `res.ok=false` + `error`（ErrorShape），close code 1008。服务器未就绪（sidecar 启动期）返回可重试错误带 `retryAfterMs`。

## 3. 帧封套（全部三种）

```jsonc
// 请求（客户端→服务器）
{ "type":"req", "id":"<唯一串>", "method":"chat.send", "params":{...} }

// 响应（服务器→客户端，与 req 的 id 配对）
{ "type":"res", "id":"<同req>", "ok":true, "payload":{...} }
{ "type":"res", "id":"<同req>", "ok":false, "error":{ "code":"INVALID_REQUEST", "message":"...", "details":?, "retryable":?, "retryAfterMs":? } }

// 事件（服务器→客户端，单向）
{ "type":"event", "event":"chat", "payload":{...}, "seq":42, "stateVersion":? }
```

- `id`：客户端生成，连接内唯一即可（数字串/uuid 均可）。
- `event.seq`：连接内单调递增；客户端应检测 gap（跳号=丢事件，需 `chat.history` 补齐）。事件可能因慢消费者被丢弃（buffered 超限会被服务器断开，close 1008 "slow consumer"）。

## 4. chat.send（operator.write）

### 4.1 请求 params（schema：ChatSendParamsSchema，additionalProperties:false——多传字段直接 INVALID_REQUEST）

```jsonc
{
  "sessionKey": "web:browser-abc123",   // 必填，1-512 字符（ChatSendSessionKeyString）
  "message": "你好",                     // 必填（与 attachments 至少其一非空）
  "idempotencyKey": "nanoid(21)",        // 必填！幂等键，即后续事件里的 runId
  "agentId": "main",                     // 可选；不填走 sessionKey 解析/默认 agent
  "sessionId": "...",                    // 可选，显式指定既有 session
  "thinking": "...",                     // 可选
  "fastMode": true,                      // 可选 bool | "auto"
  "fastAutoOnSeconds": 30,               // 可选，单轮 fast-mode 截断秒数
  "deliver": true,                       // 可选：是否同时投递到绑定 channel
  "attachments": [ { "type":..., "mimeType":..., "fileName":..., "content":... } ],  // 可选
  "timeoutMs": 120000                    // 可选，run 过期时间
}
```

**operator token 禁传字段**（需 admin scope，传了报 `INVALID_REQUEST`）：
`originatingChannel` / `originatingTo` / `originatingAccountId` / `originatingThreadId`、`systemInputProvenance`、`systemProvenanceReceipt`、`suppressCommandInterpretation`、`expectedSessionRoutingContract`（control-ui 专用路由契约）。

### 4.2 响应（res.payload）

```jsonc
// 正常受理（chat.ts:4384-4402）
{ "runId": "<=idempotencyKey", "status": "started", "serverTiming": { "receivedToAckMs":..., "loadSessionMs":..., "prepareAttachmentsMs":? } }

// 同 runId 重发（幂等去重，chat.ts:3967-3993）
{ "runId": "...", "status": "in_flight" }

// run 已被 abort 后重发
{ "runId": "...", "state": "aborted", "stopReason": "...", "endedAt": ... }
```

失败：`ok:false` + ErrorShape（§6）。`message` 为空且无 attachments → `INVALID_REQUEST "message or attachment required"`。

### 4.3 幂等语义

`idempotencyKey` 是全局幂等键：服务器按 `chat:<key>` dedupe，传输层重发安全（重试拿 `in_flight` 或缓存结果）。**每次用户发送生成新 key（nanoid/randomUUID），重试同一消息复用同一 key。** 该 key 后续贯穿所有流式事件的 `runId` 字段。

## 5. 聊天流式事件（event:"chat"）

广播事件名固定为 **`chat`**（server-chat.ts:944 / chat.ts:2755）。payload 是四态联合（schema：ChatEventSchema）：

```jsonc
// 增量输出（流式）
{ "runId":"...", "sessionKey":"...", "agentId":"main", "seq":12,
  "state":"delta", "deltaText":"今", "replace":false,        // replace=true 表示全量刷新而非追加
  "message":{...}, "usage":{...} }                            // message 可选

// 正常结束
{ "runId":"...", "sessionKey":"...", "seq":13,
  "state":"final", "message":{...}, "usage":{...}, "stopReason":"..." }

// 被中止（chat.abort / stop 指令）
{ "runId":"...", "sessionKey":"...", "seq":14,
  "state":"aborted", "message":{...}, "errorMessage":?, "stopReason":"..." }

// 运行失败；errorKind ∈ refusal|timeout|rate_limit|context_length|unknown
{ "runId":"...", "sessionKey":"...", "seq":15,
  "state":"error", "errorMessage":"...", "errorKind":"rate_limit", "usage":?, "stopReason":? }
```

公共字段：`runId`（=chat.send 的 idempotencyKey）、`sessionKey`、`agentId?`、`spawnedBy?`、`seq`（run 内单调递增，用于排序/去重）。

`message` 的形状（投影后的显示消息，chat.ts:2753 `projectChatDisplayMessage`）：

```jsonc
{ "role":"assistant", "content":[ { "type":"text", "text":"..." } ] }
```

> 实现注意：拼流式文本以 `deltaText`（replace=false 追加 / true 重绘）为准，`final.message` 作为最终校正；error/aborted 后同样要收尾 UI。

## 6. 其余 chat 方法

| 方法 | scope | params | 响应 payload |
|------|-------|--------|--------------|
| `chat.history` | read | `{ sessionKey, agentId?, limit?(1-1000,默认200), offset?(≥0), maxChars?(1-500000) }` | `{ sessionKey, sessionId, messages:[...], offset?, nextOffset?, hasMore?, totalMessages?, defaults, sessionInfo, thinkingLevel, fastMode?, verboseLevel, inFlightRun?, agentsList?, metadata? }` |
| `chat.abort` | write | `{ sessionKey, agentId?, runId?, preserveSideRuns? }` —— 不带 runId 中止整会话全部 run | `{ ok:true, aborted:bool, runIds:[...] }` |
| `chat.inject` | **admin** | `{ sessionKey, agentId?, message, label?(≤100) }` | `{ ok:true, messageId }` |
| `chat.metadata` | read | `{ agentId? }` | 会话元数据（标题候选等） |
| `chat.message.get` | read | `{ sessionKey, agentId?, messageId, maxChars?(≤2000000) }` | `{ ok, message?, unavailableReason? ∈ not_found\|oversized\|not_visible }` |

- `chat.history.messages[]` 元素形状与 §5 的 message 投影一致（role + content[]）；历史默认字节预算裁剪，超限消息会被替换/省略——前端需容忍。
- 会话历史分页：`hasMore=true` 时用 `nextOffset` 续拉。
- `inFlightRun`：切回会话时可恢复正在流式中的 run 快照。

## 7. 客户端身份（client-info.ts）

- id（收窄枚举，`webchat-ui`/`webchat`/`gateway-client`/`openclaw-control-ui`/`cli`/...）：浏览器直连用 `webchat-ui`；**BFF 后台桥接用 `gateway-client` + mode `backend`**（我们的方案）。
- mode（收窄枚举）：`webchat` | `cli` | `ui` | `backend` | `node` | `probe` | `test`。
- 收窄校验：`client.id`/`client.mode` 必须是枚举字面量，自定义字符串会被拒。

## 8. 错误码（ErrorShape.code，error-codes.ts）

| code | 含义 |
|------|------|
| `INVALID_REQUEST` | 参数校验失败/前置条件不满足（含越权字段） |
| `UNAVAILABLE` | 服务或后端暂不可用（可带 retryable/retryAfterMs） |
| `AGENT_TIMEOUT` | agent turn 超出等待窗口 |
| `NOT_LINKED` / `NOT_PAIRED` | 设备未绑定/未配对（token 模式一般不遇到） |
| `APPROVAL_NOT_FOUND` | 审批引用失效 |

ErrorShape：`{ code, message, details?, retryable?, retryAfterMs? }`；连接层错误有专门的 detail code 集（connect-error-details.ts）。

## 9. sessionKey 约定

- schema 层面仅约束：非空、≤512 字符。
- 语义结构：`{prefix}:{identifier}`，xiaobei/openclaw 惯例 `agent:{agentId}:{...}`（微信会话）、subagent 用 `agent:it-engineer:subagent:<uuid>`。
- **本项目约定：web 聊天用 `web:<browser-session-id>`**，与微信/其他 channel 会话天然隔离；`chat.history` 按同 key 读取。

## 10. 广播事件全集（GATEWAY_EVENTS，server-methods-list.ts）

`connect.challenge`、`agent`、`chat`、`session.message`、`session.operation`、`session.tool`、`sessions.changed`、`presence`、`tick`、`talk.mode`、`talk.event`、`shutdown`、`health`、`heartbeat`、`cron`、`task`、`node.pair.requested`、`node.pair.resolved`、`node.invoke.request`、`device.pair.requested`、`device.pair.resolved`、`voicewake.changed`、`voicewake.routing.changed`、`exec.approval.requested`、`exec.approval.resolved`、`plugin.approval.requested`、`plugin.approval.resolved`、`terminal.data`、`terminal.exit`、update-available。

> Phase 1 聊天页只消费 `chat` + `connect.challenge` + `tick`；`sessions.changed` 可用于会话列表刷新（Phase 1 dashboard）。

## 11. 对 xiaobei-web 实现的落点

1. **BFF WS 桥（选型）**：token 只留在 Next.js BFF 进程。浏览器 ↔ BFF 用自有 SSE/WebSocket 协议（转发 deltaText/final/aborted/error 四态），BFF ↔ gateway 用本文协议。client id `gateway-client`、mode `backend`。
2. **握手实现最小集**：ws open → 等 `connect.challenge` 拿 nonce（保留但 token 模式不用于签名）→ 发 `connect`（protocol 4/4 + auth.token）→ 收 hello-ok，从 `features.methods` 断言 `chat.send` 存在。
3. **发送流**：生成 `id`（req 配对）+ `idempotencyKey`（nanoid）→ `chat.send` → 收 `started` ack → 订阅 `chat` 事件按 `runId` 过滤 → delta 拼接（replace 分支）→ final/aborted/error 收尾。
4. **中断**：`chat.abort { sessionKey, runId }` 精确停单次 run。
5. **断线重连**：重连后重新握手；用 `chat.history` 补齐断线期间消息（seq gap 检测触发）。
6. **联调校正点**（源码推定，以真机为准）：`delta.message` 是否每帧携带全量、`usage` 字段结构、`chat.history` message 的完整 content 类型集合（工具调用块等）。

## 12. 协议安全红线

- token 只存 BFF（`.env.local` / 服务端环境），永不下发浏览器。
- 不传 §4.1 禁传字段（operator scope 会被拒）。
- 不使用 `chat.inject`（admin-only，非本项目需求）。
- 连接仅 loopback：gateway `bind:loopback` + 明文 ws 仅限 127.0.0.1，不要为了远程访问改 bind——远程走 SSH 隧道。
