// GET /api/chat/sessions：web 可见会话列表（BFF → gateway sessions.list）。
// 只返回 web 会话空间的 key（裸 web: 与 agent:*:web:），渠道会话不外泄。
import type { NextRequest } from "next/server";

import { authDeniedResponse, checkApiAuth, jsonResponse } from "@/lib/api-auth";
import { getGatewayConnection, isValidWebSessionKey } from "@/lib/gateway";

export const dynamic = "force-dynamic";

type GatewayRow = {
  key?: unknown;
  kind?: unknown;
  displayName?: unknown;
  derivedTitle?: unknown;
  lastMessagePreview?: unknown;
  updatedAt?: unknown;
  hasActiveRun?: unknown;
};

export async function GET(req: NextRequest) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  try {
    const conn = getGatewayConnection();
    const payload = (await conn.request("sessions.list", {
      limit: 100,
      includeLastMessage: true,
      includeDerivedTitles: true,
    })) as { sessions?: GatewayRow[] };

    const sessions = (payload.sessions ?? [])
      .filter((s): s is GatewayRow & { key: string } => typeof s.key === "string")
      .filter((s) => isValidWebSessionKey(s.key))
      .map((s) => ({
        key: s.key,
        displayName: typeof s.displayName === "string" ? s.displayName : null,
        derivedTitle: typeof s.derivedTitle === "string" ? s.derivedTitle : null,
        lastMessagePreview: typeof s.lastMessagePreview === "string" ? s.lastMessagePreview : null,
        updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : null,
        hasActiveRun: s.hasActiveRun === true,
      }))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

    return jsonResponse({ ok: true, sessions });
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "sessions.list failed" },
      502,
    );
  }
}
