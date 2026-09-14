// SSE 下行流：把 gateway 的 chat 事件按 sessionKey 过滤后转发给浏览器。
// 浏览器用 EventSource 订阅；断线由 EventSource 自动重连。

import type { NextRequest } from "next/server";

import { authDeniedResponse, checkApiAuth } from "@/lib/api-auth";
import {
  getGatewayConnection,
  isValidWebSessionKey,
  type ChatEventPayload,
  type ConnState,
} from "@/lib/gateway";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  const sessionKey = req.nextUrl.searchParams.get("sessionKey") ?? "";
  if (!isValidWebSessionKey(sessionKey)) {
    return new Response("invalid sessionKey", { status: 400 });
  }

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

      const offChat = conn.onChatEvent((payload: ChatEventPayload) => {
        // gateway 会把会话键规范化为 agent:{agentId}:{原始键}（事件带规范化键），
        // 用后缀匹配同时覆盖原始键与规范化键
        if (payload.sessionKey === sessionKey || payload.sessionKey.endsWith(`:${sessionKey}`)) {
          send("chat", payload);
        }
      });
      const offState = conn.onStateChange((state: ConnState) => {
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
        send("gateway", { state: conn.getState() });
        send("ready", { sessionKey });
      } catch (err) {
        send("gateway", {
          state: "closed",
          error: err instanceof Error ? err.message : "gateway 连接失败",
        });
        // 保持流打开一小段时间，EventSource 会自动重连；立即关闭也行
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
