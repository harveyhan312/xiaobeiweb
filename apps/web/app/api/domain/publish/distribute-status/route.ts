import { NextResponse, type NextRequest } from "next/server";

import { authDeniedResponse, checkApiAuth } from "@/lib/api-auth";
import { scriptResponse } from "@/lib/api-script";
import { PLATFORM_SET } from "@/lib/xiaobei-domain";
import { setDistributeStatus } from "@/lib/xiaobei-write";

export const dynamic = "force-dynamic";

// BFF 只允许按 id 单行写（脚本还支持 --source-folder 批量与 --mark-all-distributed，
// 批量误伤面大，不开放给 web）。
export async function POST(req: NextRequest) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  const body = (await req.json().catch(() => null)) as {
    platform?: unknown;
    id?: unknown;
    status?: unknown;
  } | null;
  const platform = String(body?.platform ?? "");
  const id = Number(body?.id);
  const status = String(body?.status ?? "");
  if (!PLATFORM_SET.has(platform)) {
    return NextResponse.json({ error: "unknown platform" }, { status: 400 });
  }
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }
  if (!/^[012]$/.test(status)) {
    return NextResponse.json({ error: "status must be 0, 1 or 2" }, { status: 400 });
  }
  return scriptResponse(await setDistributeStatus(platform, id, status));
}
