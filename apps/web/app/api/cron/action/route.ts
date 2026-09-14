import { removeCronJob, runCronJob, setCronJobEnabled } from "@/lib/cron-rpc";
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
  if (action !== "run" && action !== "remove" && action !== "toggle") {
    return jsonResponse({ error: "action 必须是 run、remove 或 toggle" }, 400);
  }
  if (id === "") {
    return jsonResponse({ error: "需要 id" }, 400);
  }
  if (action === "toggle" && typeof body.enabled !== "boolean") {
    return jsonResponse({ error: "toggle 需要 enabled 布尔值" }, 400);
  }

  try {
    if (action === "run") {
      const mode = body.mode === "due" ? "due" : "force";
      return jsonResponse({ ok: true, result: await runCronJob(id, mode) });
    }
    if (action === "remove") {
      return jsonResponse({ ok: true, result: await removeCronJob(id) });
    }
    return jsonResponse({ ok: true, result: await setCronJobEnabled(id, body.enabled as boolean) });
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
