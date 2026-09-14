import { applyChannelBinding } from "@/lib/config-rpc";
import { parseChannelRequest } from "@/lib/config-templates";
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

  const parsed = parseChannelRequest(body);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);

  try {
    return jsonResponse(await applyChannelBinding(parsed.input));
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
