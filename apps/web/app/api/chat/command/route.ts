// POST /api/chat/command：快捷指令一键委托。
// 浏览器只上送 {commandId, params, idempotencyKey}；prompt 由 BFF 渲染，
// 经 chat.send 进入目标 agent 会话（sessionKey 由服务端生成，浏览器不掌握形态）。
import { NextResponse, type NextRequest } from "next/server";

import { authDeniedResponse, checkApiAuth } from "@/lib/api-auth";
import { GatewayRequestError, getGatewayConnection } from "@/lib/gateway";
import { OBSERVATION_PAGES } from "@/lib/command-catalog";
import { validateAndRender } from "@/lib/command-rpc";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  let body: { commandId?: unknown; params?: unknown; idempotencyKey?: unknown; dryRun?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // dryRun=预览：同一套校验与渲染，只回显 prompt，不发 send、不建会话
  if (body.dryRun === true) {
    const rendered = validateAndRender(body.commandId, body.params);
    if (!rendered.ok) {
      return NextResponse.json({ error: rendered.error }, { status: 400 });
    }
    return NextResponse.json({ prompt: rendered.prompt });
  }

  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(idempotencyKey)) {
    return NextResponse.json({ error: "invalid idempotencyKey" }, { status: 400 });
  }

  const rendered = validateAndRender(body.commandId, body.params);
  if (!rendered.ok) {
    return NextResponse.json({ error: rendered.error }, { status: 400 });
  }

  try {
    const conn = getGatewayConnection();
    const payload = (await conn.request("chat.send", {
      sessionKey: rendered.sessionKey,
      message: rendered.prompt,
      agentId: rendered.targetAgentId,
      idempotencyKey,
    })) as { runId?: string; status?: string };
    // P1：observationHint 供前端渲染「去观测页查看」直达链接
    return NextResponse.json({
      ...payload,
      commandId: body.commandId,
      sessionKey: rendered.sessionKey,
      observationHint: { page: OBSERVATION_PAGES[String(body.commandId)] ?? null, filter: { sessionKey: rendered.sessionKey } },
    });
  } catch (err) {
    const code = err instanceof GatewayRequestError ? err.code : "UNKNOWN";
    const status = code === "INVALID_REQUEST" ? 400 : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "chat.send failed", code },
      { status },
    );
  }
}
