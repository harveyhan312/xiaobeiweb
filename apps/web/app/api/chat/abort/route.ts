import { NextResponse, type NextRequest } from "next/server";

import { authDeniedResponse, checkApiAuth } from "@/lib/api-auth";
import { getGatewayConnection, isValidWebSessionKey } from "@/lib/gateway";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  let body: { sessionKey?: string; runId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const sessionKey = body.sessionKey ?? "";
  if (!isValidWebSessionKey(sessionKey)) {
    return NextResponse.json({ error: "invalid sessionKey" }, { status: 400 });
  }

  try {
    const conn = getGatewayConnection();
    const params: Record<string, string> = { sessionKey };
    if (body.runId) {
      params.runId = body.runId;
    }
    const payload = (await conn.request("chat.abort", params)) as {
      ok?: boolean;
      aborted?: boolean;
      runIds?: string[];
    };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "chat.abort failed" },
      { status: 502 },
    );
  }
}
