import { NextResponse, type NextRequest } from "next/server";

import { authDeniedResponse, checkApiAuth } from "@/lib/api-auth";
import { scriptResponse } from "@/lib/api-script";
import { PLATFORM_SET } from "@/lib/xiaobei-domain";
import { updateMetrics } from "@/lib/xiaobei-write";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  const body = (await req.json().catch(() => null)) as {
    platform?: unknown;
    id?: unknown;
    metrics?: unknown;
  } | null;
  const platform = String(body?.platform ?? "");
  const id = Number(body?.id);
  const metrics = body?.metrics;
  if (!PLATFORM_SET.has(platform)) {
    return NextResponse.json({ error: "unknown platform" }, { status: 400 });
  }
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return NextResponse.json({ error: "metrics object is required" }, { status: 400 });
  }
  return scriptResponse(await updateMetrics(platform, id, metrics as Record<string, unknown>));
}
