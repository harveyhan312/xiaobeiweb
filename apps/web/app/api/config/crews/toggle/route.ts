import { disableCrew, enableCrew } from "@/lib/crew-rpc";
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

  const action = body.action;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (action !== "enable" && action !== "disable") {
    return jsonResponse({ error: "action 必须是 enable 或 disable" }, 400);
  }
  if (id === "") {
    return jsonResponse({ error: "需要 id" }, 400);
  }

  try {
    const result = action === "enable" ? await enableCrew(id) : await disableCrew(id);
    return jsonResponse(result);
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
