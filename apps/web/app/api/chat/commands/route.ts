// GET /api/chat/commands：指令目录元数据（红线：剥离 promptTemplate，模板永不进前端）。
import type { NextRequest } from "next/server";

import { authDeniedResponse, checkApiAuth, jsonResponse } from "@/lib/api-auth";
import { COMMAND_CATALOG, OBSERVATION_PAGES } from "@/lib/command-catalog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = checkApiAuth(req);
  if (denied) return authDeniedResponse(denied);

  return jsonResponse({
    ok: true,
    commands: COMMAND_CATALOG.map((c) => ({
      id: c.id,
      group: c.group,
      label: c.label,
      description: c.description,
      targetAgentId: c.targetAgentId,
      observationPage: OBSERVATION_PAGES[c.id] ?? null,
      params: c.params,
    })),
  });
}
