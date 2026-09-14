import { NextResponse, type NextRequest } from "next/server";

import { authDeniedResponse, checkApiAuth } from "@/lib/api-auth";
import { getGatewayConnection, isValidWebSessionKey } from "@/lib/gateway";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  const sessionKey = req.nextUrl.searchParams.get("sessionKey") ?? "";
  if (!isValidWebSessionKey(sessionKey)) {
    return NextResponse.json({ error: "invalid sessionKey" }, { status: 400 });
  }
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "200");
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 1000) : 200;

  try {
    const conn = getGatewayConnection();
    const payload = (await conn.request("chat.history", { sessionKey, limit })) as {
      sessionId?: string;
      messages?: Array<unknown>;
      hasMore?: boolean;
      totalMessages?: number;
    };
    return NextResponse.json({
      sessionId: payload.sessionId,
      messages: payload.messages ?? [],
      hasMore: payload.hasMore,
      totalMessages: payload.totalMessages,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "chat.history failed" },
      { status: 502 },
    );
  }
}
