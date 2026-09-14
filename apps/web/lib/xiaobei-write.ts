// xiaobei 域数据写回层：只调用 agent 侧已封装的具名 CLI 子脚本
// （published-track / ir-record / customer-db），不直接改库。
//
// 脚本用自身路径推导 workspace ROOT（而非环境变量），因此这里按读层同一约定
// 用 OPENCLAW_STATE_DIR 解析脚本位置——sandbox 测试时指向夹具树即可生效。
//
// 防线（脚本对 --id/--platform 等不做整数/枚举校验、直接拼 SQL，BFF 必须白名单）：
// 1. execFile + 参数数组（无 shell），参数原样传递；
// 2. 本模块在调用前做整数/枚举/字符集白名单复检，非法入参直接拒绝。

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = process.env.OPENCLAW_STATE_DIR ?? join(homedir(), ".openclaw");
const MAIN_WS = join(STATE_DIR, "workspace-main");
const SALES_WS = join(STATE_DIR, "workspace-sales-cs");

const INT_RE = /^[1-9]\d{0,8}$/;
const METRIC_COL_RE = /^[a-z][a-z0-9_]{0,39}$/;
const METRIC_VALUE_RE = /^\d{1,9}$/;
// 备注/回执文本：字母数字标点空白，禁止控制字符；脚本侧另有单引号转义
const TEXT_RE = /^[\p{L}\p{N}\p{P}\p{Zs}]{1,500}$/u;

// expert-ir 状态机：new → contacted → bp_sent → meeting → dd → ts → invested，任意阶段可转 passed
export const IR_STATUSES = [
  "new",
  "contacted",
  "bp_sent",
  "meeting",
  "dd",
  "ts",
  "invested",
  "passed",
] as const;

export type ScriptResult = { ok: boolean; stdout: string; stderr: string };

function runScript(scriptPath: string, args: string[], cwd?: string): Promise<ScriptResult> {
  return new Promise((resolve) => {
    execFile(
      "bash",
      [scriptPath, ...args],
      { cwd, timeout: 15_000, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

function reject(reason: string): ScriptResult {
  return { ok: false, stdout: "", stderr: `rejected: ${reason}` };
}

const PT_SCRIPTS = join(MAIN_WS, "skills", "published-track", "scripts");
const IR_SCRIPTS = join(MAIN_WS, "skills", "expert-ir", "tools", "ir-record", "scripts");
const CS_SCRIPTS = join(SALES_WS, "skills", "customer-db", "scripts");

export function setDistributeStatus(
  platform: string,
  id: number,
  status: string,
): Promise<ScriptResult> {
  const sid = String(id);
  if (!INT_RE.test(sid)) return Promise.resolve(reject("id 必须为正整数"));
  if (!/^(0|1|2)$/.test(status)) return Promise.resolve(reject("status 必须为 0/1/2"));
  return runScript(join(PT_SCRIPTS, "set-distribute-status.sh"), [
    "--platform",
    platform,
    "--id",
    sid,
    "--status",
    status,
  ]);
}

export function updateMetrics(
  platform: string,
  id: number,
  metrics: Record<string, unknown>,
): Promise<ScriptResult> {
  const sid = String(id);
  if (!INT_RE.test(sid)) return Promise.resolve(reject("id 必须为正整数"));
  const entries = Object.entries(metrics);
  if (entries.length === 0 || entries.length > 8) {
    return Promise.resolve(reject("metrics 需 1-8 个数值列"));
  }
  const args: string[] = ["--platform", platform, "--id", sid];
  for (const [col, val] of entries) {
    const v = String(val);
    if (!METRIC_COL_RE.test(col)) return Promise.resolve(reject(`非法指标列名: ${col}`));
    if (col.startsWith("cal_")) {
      return Promise.resolve(reject(`校准列 ${col} 不开放（content-calibrator 职责）`));
    }
    if (!METRIC_VALUE_RE.test(v)) return Promise.resolve(reject(`指标 ${col} 仅接受非负整数`));
    args.push(`--${col}`, v);
  }
  return runScript(join(PT_SCRIPTS, "update-metrics.sh"), args);
}

export function updateIrStatus(
  id: number,
  status: string,
  notes?: string,
): Promise<ScriptResult> {
  const sid = String(id);
  if (!INT_RE.test(sid)) return Promise.resolve(reject("id 必须为正整数"));
  const args = ["--id", sid, "--status", status];
  if (notes !== undefined) {
    const n = notes.trim();
    if (n.length > 0) {
      if (!TEXT_RE.test(n)) return Promise.resolve(reject("notes 含非法字符或超长"));
      args.push("--notes", n);
    }
  }
  return runScript(join(IR_SCRIPTS, "update-status.sh"), args);
}

export function completeFollowUp(id: number, sentText: string): Promise<ScriptResult> {
  const sid = String(id);
  if (!INT_RE.test(sid)) return Promise.resolve(reject("id 必须为正整数"));
  const t = sentText.trim();
  if (!TEXT_RE.test(t)) return Promise.resolve(reject("sentText 含非法字符或超长"));
  // customer-db 脚本以 CWD 相对路径（./db/customer.db）定位库，必须在 workspace-sales-cs 下执行
  return runScript(join(CS_SCRIPTS, "follow-up-complete.sh"), ["--id", sid, "--sent-text", t], SALES_WS);
}

export function cancelPendingFollowUps(peer: string): Promise<ScriptResult> {
  if (!/^[\p{L}\p{N}:@._-]{1,100}$/u.test(peer)) {
    return Promise.resolve(reject("peer 格式非法"));
  }
  return runScript(join(CS_SCRIPTS, "follow-up-cancel-pending.sh"), ["--peer", peer], SALES_WS);
}
