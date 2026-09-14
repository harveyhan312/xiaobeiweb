// 写 API 公共响应映射：脚本 JSON/纯文本输出统一为 {ok, ...}；
// BFF 白名单拒绝（stderr 前缀 rejected:）返回 400，脚本执行失败返回 502。
import { NextResponse } from "next/server";

import type { ScriptResult } from "./xiaobei-write";

export function scriptResponse(res: ScriptResult): NextResponse {
  if (!res.ok) {
    const msg = res.stderr.trim() || res.stdout.trim() || "脚本执行失败";
    const status = res.stderr.startsWith("rejected:") ? 400 : 502;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
  let data: unknown = res.stdout.trim();
  try {
    data = JSON.parse(res.stdout);
  } catch {
    // 纯文本输出（customer-db 脚本）
  }
  if (data && typeof data === "object") {
    return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
  }
  return NextResponse.json({ ok: true, message: String(data) });
}
