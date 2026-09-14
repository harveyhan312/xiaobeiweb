import { NextResponse, type NextRequest } from "next/server";

import { authDeniedResponse, checkApiAuth } from "@/lib/api-auth";
import { GatewayRequestError, getGatewayConnection, isValidWebSessionKey } from "@/lib/gateway";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_CHARS = 32_000;

export async function POST(req: NextRequest) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  let body: { sessionKey?: string; message?: string; idempotencyKey?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const sessionKey = body.sessionKey ?? "";
  const message = (body.message ?? "").trim();
  // 幂等键由浏览器生成：失败重试复用同一 key，gateway 按 key 去重（协议 §4.3），BFF 只校验透传
  const idempotencyKey = (body.idempotencyKey ?? "").trim();
  if (!isValidWebSessionKey(sessionKey)) {
    return NextResponse.json({ error: "invalid sessionKey" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: "message too long" }, { status: 413 });
  }
  if (!/^[A-Za-z0-9-]{8,64}$/.test(idempotencyKey)) {
    return NextResponse.json({ error: "invalid idempotencyKey" }, { status: 400 });
  }

  try {
    const conn = getGatewayConnection();
    const payload = (await conn.request("chat.send", {
      sessionKey,
      message,
      idempotencyKey,
    })) as { runId?: string; status?: string };
    return NextResponse.json(payload);
  } catch (err) {
    const code = err instanceof GatewayRequestError ? err.code : "UNKNOWN";
    const status = code === "INVALID_REQUEST" ? 400 : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "chat.send failed", code },
      { status },
    );
  }
}
