import { NextResponse, type NextRequest } from "next/server";

import { authDeniedResponse, checkApiAuth } from "@/lib/api-auth";
import { scriptResponse } from "@/lib/api-script";
import { IR_STATUSES, updateIrStatus } from "@/lib/xiaobei-write";

export const dynamic = "force-dynamic";

const IR_STATUS_SET = new Set<string>(IR_STATUSES);

export async function POST(req: NextRequest) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  const body = (await req.json().catch(() => null)) as {
    id?: unknown;
    status?: unknown;
    notes?: unknown;
  } | null;
  const id = Number(body?.id);
  const status = String(body?.status ?? "");
  const notes = body?.notes === undefined ? undefined : String(body?.notes);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
  }
  if (!IR_STATUS_SET.has(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }
  if (notes !== undefined && typeof body?.notes !== "string") {
    return NextResponse.json({ error: "notes must be a string" }, { status: 400 });
  }
  return scriptResponse(await updateIrStatus(id, status, notes));
}
