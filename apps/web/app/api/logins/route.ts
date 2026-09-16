// GET /api/logins：平台登录态元数据（只读）。
// 红线：只出元数据（平台/状态/updated_at/最近过期时间/cookie name），绝不返回 cookie value。
import type { NextRequest } from "next/server";

import { authDeniedResponse, checkApiAuth, jsonResponse } from "@/lib/api-auth";
import { getLoginStatuses, summarizeLoginStatuses } from "@/lib/xiaobei-logins";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  const platforms = getLoginStatuses();
  return jsonResponse({ ok: true, platforms, summary: summarizeLoginStatuses(platforms) });
}
