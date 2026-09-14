import { deriveCrewStates } from "@/lib/crew-rpc";
import { fetchConfigSnapshot } from "@/lib/config-rpc";
import { checkApiAuth, authDeniedResponse, jsonResponse } from "@/lib/api-auth";
import { GatewayRequestError } from "@/lib/gateway";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  try {
    const snap = await fetchConfigSnapshot();
    const states = deriveCrewStates(snap);
    return jsonResponse({
      hash: snap.hash ?? null,
      ...states,
    });
  } catch (err) {
    if (err instanceof GatewayRequestError) {
      return jsonResponse({ error: err.message }, 502);
    }
    return jsonResponse({ error: String(err instanceof Error ? err.message : err) }, 500);
  }
}
