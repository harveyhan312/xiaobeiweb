import { fetchConfigSnapshot } from "@/lib/config-rpc";
import { checkApiAuth, authDeniedResponse, jsonResponse } from "@/lib/api-auth";
import { GatewayRequestError } from "@/lib/gateway";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  try {
    const snap = await fetchConfigSnapshot();
    return jsonResponse({
      hash: snap.hash ?? null,
      exists: snap.exists,
      valid: snap.valid,
      bindings: snap.bindings ?? [],
      pluginLoadPaths: snap.pluginLoadPaths ?? [],
      channels: snap.channels ?? {},
    });
  } catch (err) {
    if (err instanceof GatewayRequestError) {
      return jsonResponse({ error: err.message }, 502);
    }
    return jsonResponse({ error: String(err instanceof Error ? err.message : err) }, 500);
  }
}
