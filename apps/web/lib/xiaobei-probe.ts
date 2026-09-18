// 登录态服务端 pong 探活（Phase 4.5 T3 分支 A）：execFile 引擎侧 check-login.ts CLI
// （published-track skill；exit 0=有效 / 2=SESSION_EXPIRED / 1=SIGN_UNAVAILABLE 或 crash）。
// 防线：平台白名单 + execFile 参数数组（无 shell）；只回状态与错误文案，零 cookie 内容。
// 脚本侧 pong 有 10min TTL 缓存（~/.cache/wiseflow-check-login），自动批量探测不放大签名请求。

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

import { PROBE_PLATFORMS, type ProbePlatform, type ProbeResult, type ProbeServerState } from "./probe-shared";

export { PROBE_PLATFORMS };
export type { ProbePlatform, ProbeResult, ProbeServerState };

// checkSession 支持 pong 的平台。xhs-publish 不在该模块、wx_mp 只做 presence
// （与本地判定同源，探了也分不出服务端差异），均不入白名单。


const STATE_DIR = process.env.OPENCLAW_STATE_DIR ?? join(homedir(), ".openclaw");
const CHECK_LOGIN_TS = join(
  STATE_DIR,
  "workspace-main",
  "skills",
  "published-track",
  "scripts",
  "check-login.ts",
);

type CheckLoginOut = { ok?: boolean; error?: string; reason?: string; message?: string };

function runCheckLogin(
  platform: ProbePlatform,
): Promise<{ exitCode: number | null; out: CheckLoginOut | null }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--experimental-strip-types", CHECK_LOGIN_TS, "--platform", platform],
      { timeout: 30_000, maxBuffer: 1 << 20 },
      (err, stdout) => {
        const code = (err as { code?: unknown } | null)?.code;
        const exitCode = err ? (typeof code === "number" ? code : null) : 0;
        let out: CheckLoginOut | null = null;
        const lines = String(stdout).trim().split("\n").filter(Boolean);
        const last = lines[lines.length - 1];
        if (last) {
          try {
            out = JSON.parse(last) as CheckLoginOut;
          } catch {
            out = null;
          }
        }
        resolve({ exitCode, out });
      },
    );
  });
}

export async function probePlatform(platform: ProbePlatform): Promise<ProbeResult> {
  const { exitCode, out } = await runCheckLogin(platform);
  const base = { platform, checkedAt: Date.now() };
  if (exitCode === 0 && out?.ok) {
    return { ...base, serverState: "valid", reason: null };
  }
  if (out?.error === "SESSION_EXPIRED" || exitCode === 2) {
    return {
      ...base,
      serverState: "server-expired",
      reason: out?.reason ?? "服务端会话已失效，请重新登录",
    };
  }
  if (out?.error === "SIGN_UNAVAILABLE") {
    return {
      ...base,
      serverState: "probe-unavailable",
      reason: out?.reason ?? "探活签名凭证（OFB_KEY）未配置，非 cookie 问题",
    };
  }
  return { ...base, serverState: "probe-unavailable", reason: out?.message ?? "探活脚本执行失败" };
}
