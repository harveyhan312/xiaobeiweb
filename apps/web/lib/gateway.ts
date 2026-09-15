// BFF 侧 gateway 连接单例：实现 apps/web/docs/chat-protocol.md 的握手与帧协议。
// token 解析优先级：OPENCLAW_GATEWAY_TOKEN 环境变量 → ~/.openclaw/openclaw.json 的 gateway.auth.token。
// token 只存在于本进程，绝不返回给浏览器。

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import WebSocket from "ws";

export const GATEWAY_PROTOCOL_VERSION = 4;

export type ChatState = "delta" | "final" | "aborted" | "error";

export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  seq: number;
  state: ChatState;
  deltaText?: string;
  replace?: boolean;
  message?: GatewayMessage | null;
  errorMessage?: string;
  errorKind?: "refusal" | "timeout" | "rate_limit" | "context_length" | "unknown";
  stopReason?: string;
};

export type GatewayMessage = {
  role: string;
  content: Array<{ type: string; text?: string }>;
};

export type GatewayErrorShape = {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
};

export type ConnState = "connecting" | "ready" | "closed";

type PendingEntry = {
  resolve: (payload: unknown) => void;
  reject: (err: GatewayRequestError) => void;
  timer: NodeJS.Timeout;
};

export class GatewayRequestError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(code: string, message: string, details?: unknown, retryable = false) {
    super(message);
    this.name = "GatewayRequestError";
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

function resolveGatewayToken(): string {
  const envToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (envToken) {
    return envToken;
  }
  const stateDir = process.env.OPENCLAW_STATE_DIR ?? join(homedir(), ".openclaw");
  const cfgPath = join(stateDir, "openclaw.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as {
    gateway?: { auth?: { token?: string } };
  };
  const token = cfg.gateway?.auth?.token;
  if (!token) {
    throw new Error(
      "gateway token 未找到：设置 OPENCLAW_GATEWAY_TOKEN，或确认 ~/.openclaw/openclaw.json 的 gateway.auth.token",
    );
  }
  return token;
}

function gatewayUrl(): string {
  return process.env.OPENCLAW_GATEWAY_URL ?? "ws://127.0.0.1:18789";
}

type Frame =
  | { type: "req"; id: string; method: string; params?: unknown }
  | { type: "res"; id: string; ok: boolean; payload?: unknown; error?: GatewayErrorShape }
  | { type: "event"; event: string; payload?: unknown; seq?: number };

export class GatewayConnection {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingEntry>();
  private chatListeners = new Set<(payload: ChatEventPayload) => void>();
  private stateListeners = new Set<(state: ConnState) => void>();
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffMs = 1000;
  private lastActivityAt = Date.now();
  private watchdogTimer: NodeJS.Timeout | null = null;
  private state: ConnState = "closed";

  getState(): ConnState {
    return this.state;
  }

  onChatEvent(listener: (payload: ChatEventPayload) => void): () => void {
    this.chatListeners.add(listener);
    return () => this.chatListeners.delete(listener);
  }

  onStateChange(listener: (state: ConnState) => void): () => void {
    this.stateListeners.add(listener);
    if (this.state === "ready") {
      listener("ready");
    }
    return () => this.stateListeners.delete(listener);
  }

  private setState(next: ConnState) {
    this.state = next;
    for (const listener of this.stateListeners) {
      listener(next);
    }
  }

  async ensureConnected(): Promise<void> {
    if (this.state === "ready" && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    this.connectPromise ??= this.connect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const token = resolveGatewayToken();
      const ws = new WebSocket(gatewayUrl(), { maxPayload: 10 * 1024 * 1024 });
      this.ws = ws;
      this.setState("connecting");
      let settled = false;

      // gateway 若接受 TCP 却静默（不发 challenge / 不回 hello-ok），握手 Promise 永不
      // settle，SSE 会永久挂起——15s 超时兜底，terminate 走 close 路径触发退避重连
      const handshakeTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        console.error("[gateway] 握手 15s 超时（open/challenge/connect/hello-ok 卡在某一环）");
        ws.terminate();
        reject(new Error("gateway 握手超时（15s 内未完成 challenge→hello-ok）"));
      }, 15_000);
      handshakeTimer.unref?.();

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(handshakeTimer);
        reject(err);
      };

      ws.on("open", () => {
        this.lastActivityAt = Date.now();
        console.error("[gateway] ws open，等待 connect.challenge");
        // 服务器 open 后立即推 connect.challenge；等它拿到 nonce 再发 connect
      });

      ws.on("message", (data) => {
        this.lastActivityAt = Date.now();
        let frame: Frame;
        try {
          frame = JSON.parse(String(data)) as Frame;
        } catch {
          return;
        }
        if (frame.type === "event" && frame.event === "connect.challenge" && !settled) {
          const nonce = (frame.payload as { nonce?: string } | undefined)?.nonce ?? "";
          console.error("[gateway] challenge 已收到，发送 connect");
          if (!nonce) {
            fail(new Error("gateway connect challenge 缺少 nonce"));
            ws.close(1008, "connect challenge missing nonce");
            return;
          }
          try {
            ws.send(
            JSON.stringify({
              type: "req",
              id: randomUUID(),
              method: "connect",
              params: {
                minProtocol: GATEWAY_PROTOCOL_VERSION,
                maxProtocol: GATEWAY_PROTOCOL_VERSION,
                client: {
                  id: "gateway-client",
                  displayName: "xiaobei-web",
                  version: "0.1.0",
                  platform: process.platform,
                  mode: "backend",
                },
                role: "operator",
                // 默认拒绝策略：scopes 必须显式声明；本地 backend + token 认证会保留所请求 scopes。
                // admin 用于 P3-D/P3-E 配置写（config.patch / gateway.restart / cron.*）
                scopes: ["operator.read", "operator.write", "operator.admin"],
                auth: { token },
              },
            }),
          );
          } catch (sendErr) {
            fail(sendErr instanceof Error ? sendErr : new Error("connect 帧发送失败"));
            ws.terminate();
          }
          return;
        }
        if (frame.type === "res") {
          // 握手的 connect 响应不走 pending 表（challenge 处理器直接 ws.send），
          // 必须先于 pending 查找判定 hello-ok，否则握手永远完不成
          if (
            !settled &&
            (frame.payload as { type?: string } | undefined)?.type === "hello-ok"
          ) {
            settled = true;
            clearTimeout(handshakeTimer);
            this.backoffMs = 1000;
            this.setState("ready");
            this.startWatchdog();
            resolve();
            return;
          }
          // 握手期的错误 res（如 connect params 被拒）也要快速失败，
          // 否则静默丢弃后会干等 15s 超时，真实报错被吞掉
          if (!settled && !frame.ok) {
            const err = frame.error;
            fail(
              new GatewayRequestError(
                err?.code ?? "UNAVAILABLE",
                `gateway 握手被拒：${err?.message ?? "unknown error"}`,
                err?.details,
                err?.retryable === true,
              ),
            );
            ws.close(1008, "handshake rejected");
            return;
          }
          const entry = this.pending.get(frame.id);
          if (!entry) return;
          clearTimeout(entry.timer);
          this.pending.delete(frame.id);
          if (frame.ok) {
            entry.resolve(frame.payload);
          } else {
            const err = frame.error;
            entry.reject(
              new GatewayRequestError(
                err?.code ?? "UNAVAILABLE",
                err?.message ?? "gateway request failed",
                err?.details,
                err?.retryable === true,
              ),
            );
          }
          return;
        }
        if (frame.type === "event" && frame.event === "chat") {
          const payload = frame.payload as ChatEventPayload | undefined;
          if (!payload?.sessionKey) return;
          for (const listener of this.chatListeners) {
            try {
              listener(payload);
            } catch {
              // listener 异常不影响其他订阅者
            }
          }
        }
      });

      ws.on("close", () => {
        this.ws = null;
        this.stopWatchdog();
        this.flushPending(new GatewayRequestError("UNAVAILABLE", "gateway 连接已关闭"));
        if (this.state !== "closed") {
          this.setState("closed");
        }
        if (!settled) {
          settled = true;
          clearTimeout(handshakeTimer);
          reject(new Error("gateway 在握手完成前关闭"));
        }
        this.scheduleReconnect();
      });

      ws.on("error", (err) => {
        if (!settled) {
          fail(new Error(`gateway 连接失败: ${err.message}`));
        }
      });
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected().catch(() => {
        // 连不上继续退避，由下一次 close/error 触发 scheduleReconnect
        this.backoffMs = Math.min(this.backoffMs * 2, 10_000);
        this.scheduleReconnect();
      });
    }, this.backoffMs);
    this.reconnectTimer.unref?.();
  }

  private startWatchdog() {
    this.stopWatchdog();
    // hello-ok.policy.tickIntervalMs 默认 30s；90s 无任何帧视为假死
    this.watchdogTimer = setInterval(() => {
      if (Date.now() - this.lastActivityAt > 90_000) {
        this.ws?.terminate();
      }
    }, 30_000);
    this.watchdogTimer.unref?.();
  }

  private stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private flushPending(err: GatewayRequestError) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  async request(method: string, params: unknown, timeoutMs = 20_000): Promise<unknown> {
    await this.ensureConnected();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new GatewayRequestError("UNAVAILABLE", "gateway 未连接");
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new GatewayRequestError("AGENT_TIMEOUT", `gateway 请求超时: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }
}

// Next dev 模式模块会被重复加载，用 globalThis 保住单例与已建立的 WS 连接
const globalForGateway = globalThis as unknown as { __gatewayConn?: GatewayConnection };

export function getGatewayConnection(): GatewayConnection {
  globalForGateway.__gatewayConn ??= new GatewayConnection();
  return globalForGateway.__gatewayConn;
}

// web 聊天专用 sessionKey 前缀，隔离微信等其他 channel 会话
export function isValidWebSessionKey(sessionKey: string): boolean {
  return /^web:[A-Za-z0-9-]{8,64}$/.test(sessionKey);
}

export function messageTextOf(message: GatewayMessage | null | undefined): string {
  if (!message?.content) return "";
  return message.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}
