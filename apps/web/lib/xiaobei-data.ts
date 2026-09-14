// 引擎数据层：只读访问 ~/.openclaw 的 sqlite + json + 目录。
// 铁律：所有连接 readOnly:true，所有 JSON 只读，绝不写回。密钥字段一律剔除。

import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = process.env.OPENCLAW_STATE_DIR ?? join(homedir(), ".openclaw");

function statePath(...parts: string[]): string {
  return join(STATE_DIR, ...parts);
}

function openEngineDb(): DatabaseSync {
  return new DatabaseSync(statePath("state", "openclaw.sqlite"), { readOnly: true });
}

export type TaskRun = {
  taskId: string;
  agentId: string | null;
  status: string;
  label: string | null;
  createdAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  error: string | null;
  progressSummary: string | null;
  terminalSummary: string | null;
};

export function getTaskRuns(limit = 50): TaskRun[] {
  const db = openEngineDb();
  try {
    const rows = db
      .prepare(
        `SELECT task_id, agent_id, status, label, created_at, started_at, ended_at, error, progress_summary, terminal_summary
         FROM task_runs ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      taskId: String(r.task_id ?? ""),
      agentId: (r.agent_id as string) ?? null,
      status: String(r.status ?? "unknown"),
      label: (r.label as string) ?? null,
      createdAt: (r.created_at as number) ?? null,
      startedAt: (r.started_at as number) ?? null,
      endedAt: (r.ended_at as number) ?? null,
      error: (r.error as string) ?? null,
      progressSummary: (r.progress_summary as string) ?? null,
      terminalSummary: (r.terminal_summary as string) ?? null,
    }));
  } finally {
    db.close();
  }
}

export type FlowRun = {
  flowId: string;
  status: string;
  goal: string | null;
  currentStep: string | null;
  blockedSummary: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export function getFlowRuns(limit = 20): FlowRun[] {
  const db = openEngineDb();
  try {
    const rows = db
      .prepare(
        `SELECT flow_id, status, goal, current_step, blocked_summary, created_at, updated_at
         FROM flow_runs ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      flowId: String(r.flow_id ?? ""),
      status: String(r.status ?? "unknown"),
      goal: (r.goal as string) ?? null,
      currentStep: (r.current_step as string) ?? null,
      blockedSummary: (r.blocked_summary as string) ?? null,
      createdAt: (r.created_at as number) ?? null,
      updatedAt: (r.updated_at as number) ?? null,
    }));
  } finally {
    db.close();
  }
}

export type CronJob = {
  jobId: string;
  name: string;
  agentId: string | null;
  enabled: number;
  scheduleKind: string | null;
  scheduleExpr: string | null;
  nextRunAtMs: number | null;
  lastRunAtMs: number | null;
  lastRunStatus: string | null;
  lastError: string | null;
};

export function getCronJobs(): CronJob[] {
  const db = openEngineDb();
  try {
    const rows = db
      .prepare(
        `SELECT job_id, name, agent_id, enabled, schedule_kind, schedule_expr,
                next_run_at_ms, last_run_at_ms, last_run_status, last_error
         FROM cron_jobs ORDER BY next_run_at_ms ASC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      jobId: String(r.job_id ?? ""),
      name: String(r.name ?? r.job_id),
      agentId: (r.agent_id as string) ?? null,
      enabled: Number(r.enabled ?? 0),
      scheduleKind: (r.schedule_kind as string) ?? null,
      scheduleExpr: (r.schedule_expr as string) ?? null,
      nextRunAtMs: (r.next_run_at_ms as number) ?? null,
      lastRunAtMs: (r.last_run_at_ms as number) ?? null,
      lastRunStatus: (r.last_run_status as string) ?? null,
      lastError: (r.last_error as string) ?? null,
    }));
  } finally {
    db.close();
  }
}

export type SessionEntry = {
  sessionKey: string;
  sessionId: string;
  provider: string | null;
  originLabel: string | null;
  updatedAt: number | null;
  lastInteractionAt: number | null;
};

export function getSessionsIndex(agentId = "main"): SessionEntry[] {
  const file = statePath("agents", agentId, "sessions", "sessions.json");
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    {
      sessionId?: string;
      updatedAt?: number;
      lastInteractionAt?: number;
      origin?: { label?: string; provider?: string };
    }
  >;
  return Object.entries(raw)
    .map(([sessionKey, v]) => ({
      sessionKey,
      sessionId: v.sessionId ?? "",
      provider: v.origin?.provider ?? null,
      originLabel: v.origin?.label ?? null,
      updatedAt: v.updatedAt ?? null,
      lastInteractionAt: v.lastInteractionAt ?? null,
    }))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export type MediaDirSummary = {
  name: string;
  path: string;
  exists: boolean;
  fileCount: number;
};

const MEDIA_DIRS = ["inbound", "outbound", "browser"];

export function getMediaSummary(): MediaDirSummary[] {
  const base = statePath("media");
  return MEDIA_DIRS.map((name) => {
    const dir = join(base, name);
    let exists = false;
    let fileCount = 0;
    try {
      fileCount = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).length;
      exists = true;
    } catch {
      exists = false;
    }
    return { name, path: dir.replace(homedir(), "~"), exists, fileCount };
  });
}

// 递归剔除疑似密钥的字段（key/token/secret/password/apiKey 等）
function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripSecrets);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/key|token|secret|password|credential/i.test(k)) {
        out[k] = typeof v === "string" && v.length > 0 ? "（已隐藏）" : stripSecrets(v);
      } else {
        out[k] = stripSecrets(v);
      }
    }
    return out;
  }
  return value;
}

export type ConfigSummary = {
  agents: Array<{ id: string; name: string; model: string | null }>;
  channels: Array<{ id: string; enabled: boolean }>;
  providers: Array<{ id: string; baseUrl: string | null; api: string | null }>;
  defaultModel: string | null;
  gateway: { bind: string | null; port: number | null; authMode: string | null };
};

export function getConfigSummary(): ConfigSummary {
  const file = statePath("openclaw.json");
  // 整体过一遍 stripSecrets 再取字段：下方手挑字段之外多一层兜底，
  // 防止未来扩字段时把密钥带进摘要
  const cfg = stripSecrets(JSON.parse(readFileSync(file, "utf8"))) as {
    agents?: {
      list?: Array<Record<string, unknown>>;
      defaults?: { model?: unknown };
    };
    channels?: Record<string, { enabled?: boolean }>;
    models?: {
      providers?: Record<string, Record<string, unknown>>;
      providersOrder?: string[];
    };
    gateway?: { bind?: string; port?: number; auth?: { mode?: string } };
  };

  const providers = Object.entries(cfg.models?.providers ?? {}).map(([id, p]) => ({
    id,
    baseUrl: (p.baseUrl as string) ?? null,
    api: (p.api as string) ?? null,
  }));

  const defaultsModel = cfg.agents?.defaults?.model;
  const defaultModel =
    typeof defaultsModel === "string"
      ? defaultsModel
      : ((defaultsModel as { primary?: string } | undefined)?.primary ?? null);

  return {
    agents: (cfg.agents?.list ?? []).map((a) => ({
      id: String(a.id ?? ""),
      name: (a.name as string) ?? null,
      model: (a.model as string) ?? null,
    })),
    channels: Object.entries(cfg.channels ?? {}).map(([id, c]) => ({
      id,
      enabled: c?.enabled !== false,
    })),
    providers,
    defaultModel,
    gateway: {
      bind: cfg.gateway?.bind ?? null,
      port: cfg.gateway?.port ?? null,
      authMode: cfg.gateway?.auth?.mode ?? null,
    },
  };
}

export function formatMs(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}
