// POST /api/logins/probe：单平台服务端 pong 探活（Phase 4.5 T3 分支 A）。
// 平台白名单 + execFile 无 shell；结果只含状态与错误文案，零 cookie 内容。
import type { NextRequest } from "next/server";

import { authDeniedResponse, checkApiAuth, jsonResponse } from "@/lib/api-auth";
import { probePlatform, PROBE_PLATFORMS, type ProbePlatform } from "@/lib/xiaobei-probe";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  let body: { platform?: unknown };
  try {
    body = (await req.json()) as { platform?: unknown };
  } catch {
    return jsonResponse({ ok: false, error: "请求体不是合法 JSON" }, 400);
  }
  const platform = body.platform;
  if (
    typeof platform !== "string" ||
    !(PROBE_PLATFORMS as readonly string[]).includes(platform)
  ) {
    return jsonResponse({ ok: false, error: "platform 不在探活白名单" }, 400);
  }
  const result = await probePlatform(platform as ProbePlatform);
  return jsonResponse({ ok: true, result });
}
