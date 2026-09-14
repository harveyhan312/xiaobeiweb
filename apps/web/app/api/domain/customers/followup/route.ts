import { NextResponse, type NextRequest } from "next/server";

import { authDeniedResponse, checkApiAuth } from "@/lib/api-auth";
import { scriptResponse } from "@/lib/api-script";
import { cancelPendingFollowUps, completeFollowUp } from "@/lib/xiaobei-write";

export const dynamic = "force-dynamic";

// complete：按 follow_up.id 标记完成（pending/sent_once → completed，需回执文本）；
// cancel：按 peer 把该客户所有 pending 任务标完成。cs_record.business_status 由
// 系统 hook 写入，web 不提供修改入口。
export async function POST(req: NextRequest) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  const body = (await req.json().catch(() => null)) as {
    action?: unknown;
    id?: unknown;
    peer?: unknown;
    sentText?: unknown;
  } | null;
  const action = String(body?.action ?? "");
  if (action === "complete") {
    const id = Number(body?.id);
    const sentText = String(body?.sentText ?? "");
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
    }
    if (!sentText.trim()) {
      return NextResponse.json({ error: "sentText is required" }, { status: 400 });
    }
    return scriptResponse(await completeFollowUp(id, sentText));
  }
  if (action === "cancel") {
    const peer = String(body?.peer ?? "");
    if (!peer) {
      return NextResponse.json({ error: "peer is required" }, { status: 400 });
    }
    return scriptResponse(await cancelPendingFollowUps(peer));
  }
  return NextResponse.json({ error: "action must be complete or cancel" }, { status: 400 });
}
