import { requestGatewayRestart, restartGatewayPreflight } from "@/lib/config-rpc";
import { checkApiAuth, authDeniedResponse, jsonResponse } from "@/lib/api-auth";
import { GatewayRequestError } from "@/lib/gateway";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  try {
    const preflight = await restartGatewayPreflight();
    const result = await requestGatewayRestart();
    return jsonResponse({ preflight, result });
  } catch (err) {
    if (err instanceof GatewayRequestError) {
      return jsonResponse({ error: err.message }, 502);
    }
    return jsonResponse({ error: String(err instanceof Error ? err.message : err) }, 500);
  }
}
