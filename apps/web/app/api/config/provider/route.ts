import { updateModelProvider } from "@/lib/config-rpc";
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

  if (typeof body.providerId !== "string" || body.providerId.trim() === "") {
    return jsonResponse({ error: "需要 providerId" }, 400);
  }
  const input: { providerId: string; apiKey?: string; baseUrl?: string } = {
    providerId: body.providerId,
  };
  if (typeof body.apiKey === "string" && body.apiKey.trim() !== "") input.apiKey = body.apiKey;
  if (typeof body.baseUrl === "string" && body.baseUrl.trim() !== "") input.baseUrl = body.baseUrl;

  try {
    return jsonResponse(await updateModelProvider(input));
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
