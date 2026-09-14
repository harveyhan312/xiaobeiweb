import { setAgentModel } from "@/lib/crew-rpc";
import { checkApiAuth, authDeniedResponse, jsonResponse } from "@/lib/api-auth";
import { GatewayRequestError } from "@/lib/gateway";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "body 必须是 JSON" }, 400);
  }

  if (
    typeof body.agentId !== "string" ||
    body.agentId.trim() === "" ||
    typeof body.model !== "string" ||
    body.model.trim() === ""
  ) {
    return jsonResponse({ error: "需要 agentId 和 model" }, 400);
  }

  try {
    const result = await setAgentModel({ agentId: body.agentId, model: body.model });
    return jsonResponse({ ok: true, result });
  } catch (err) {
    if (err instanceof GatewayRequestError && err.code === "INVALID_REQUEST") {
      return jsonResponse({ error: err.message }, 400);
    }
    if (err instanceof GatewayRequestError) {
      return jsonResponse({ error: err.message }, 502);
    }
    return jsonResponse({ error: String(err instanceof Error ? err.message : err) }, 500);
  }
}
