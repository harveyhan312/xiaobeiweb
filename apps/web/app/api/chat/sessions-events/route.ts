// SSE 下行流：完成推送通道（Phase 4.5 T2）。
// 两路合流转发，均按 web 会话键白名单过滤（渠道会话永不出口）：
//  ① sessions.changed → 仅会话级元数据（gateway.ts 已剥离）
//  ② chat 终态 → 剥离为 {sessionKey, runId, state}，供前端 outcome（已完成/已出错）判定
// 订阅前提：sessions.changed 需在 gateway 连接上显式 sessions.subscribe（T1 实抓）。

import type { NextRequest } from "next/server";

import { authDeniedResponse, checkApiAuth } from "@/lib/api-auth";
import {
  getGatewayConnection,
  isValidWebSessionKey,
  type ChatEventPayload,
  type SessionChangeEvent,
} from "@/lib/gateway";

export const dynamic = "force-dynamic";

const TERMINAL_STATES = new Set(["final", "error", "aborted"]);

export async function GET(req: NextRequest) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  const conn = getGatewayConnection();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const offSession = conn.onSessionChange((payload: SessionChangeEvent) => {
        if (isValidWebSessionKey(payload.sessionKey)) {
          send("session", payload);
        }
      });
      const offChat = conn.onChatEvent((payload: ChatEventPayload) => {
        if (
          TERMINAL_STATES.has(payload.state) &&
          isValidWebSessionKey(payload.sessionKey)
        ) {
          send("chat-terminal", { sessionKey: payload.sessionKey, runId: payload.runId, state: payload.state });
        }
      });
      const offState = conn.onStateChange((state) => {
        send("gateway", { state });
      });

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
        }
      }, 15_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        offSession();
        offChat();
        offState();
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      };

      req.signal.addEventListener("abort", cleanup);

      try {
        await conn.ensureConnected();
        await conn.subscribeSessionEvents();
        send("ready", {});
      } catch (err) {
        send("gateway", {
          state: "closed",
          error: err instanceof Error ? err.message : "gateway 连接失败",
        });
        setTimeout(cleanup, 1000);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
