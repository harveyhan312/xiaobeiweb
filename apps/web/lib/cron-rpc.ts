// cron RPC 封装（P3-E）：gateway 原生 cron.*（计划文档原设想 MCP 桥接，
// 直连 WS RPC 更简单且同权限面，deviation 记日志）。
// 开放：list / run / remove / 启停（update state.enabled）。
// add/update 不在 web 开放：agentTurn payload 需模型与工具白名单等完整定义，
// cron 任务更适合由 agent 会话内创建（评估结论记日志）。
import { GatewayRequestError, getGatewayConnection } from "./gateway";

export type CronJobView = {
  id: string;
  name: string;
  agentId?: string;
  enabled: boolean;
  schedule: unknown;
  payloadKind?: string;
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: string;
  lastRunError?: string;
};

type RawJob = Record<string, unknown>;

function toView(j: RawJob): CronJobView {
  const schedule = j.schedule as { kind?: string } | undefined;
  const payload = j.payload as { kind?: string } | undefined;
  return {
    id: String(j.id ?? ""),
    name: String(j.name ?? ""),
    agentId: typeof j.agentId === "string" ? j.agentId : undefined,
    enabled: j.enabled === true,
    schedule,
    payloadKind: payload?.kind,
    nextRunAtMs: typeof j.nextRunAtMs === "number" ? j.nextRunAtMs : undefined,
    lastRunAtMs: typeof j.lastRunAtMs === "number" ? j.lastRunAtMs : undefined,
    lastRunStatus: typeof j.lastRunStatus === "string" ? j.lastRunStatus : undefined,
    lastRunError: typeof j.lastRunError === "string" ? j.lastRunError : undefined,
  };
}

export async function listCronJobs(): Promise<CronJobView[]> {
  const conn = getGatewayConnection();
  await conn.ensureConnected();
  const payload = (await conn.request("cron.list", {
    includeDisabled: true,
    limit: 100,
  })) as { jobs?: RawJob[] } | RawJob[];
  const jobs = Array.isArray(payload) ? payload : (payload.jobs ?? []);
  return jobs.map(toView).filter((j) => j.id !== "");
}

function assertJobId(id: string): string {
  const trimmed = id.trim();
  if (!/^[\w:-]{1,128}$/.test(trimmed)) {
    throw new GatewayRequestError("INVALID_REQUEST", "cron id 非法");
  }
  return trimmed;
}

export async function runCronJob(id: string, mode: "due" | "force" = "force"): Promise<unknown> {
  const conn = getGatewayConnection();
  await conn.ensureConnected();
  return conn.request("cron.run", { id: assertJobId(id), mode });
}

export async function removeCronJob(id: string): Promise<unknown> {
  const conn = getGatewayConnection();
  await conn.ensureConnected();
  return conn.request("cron.remove", { id: assertJobId(id) });
}

export async function setCronJobEnabled(id: string, enabled: boolean): Promise<unknown> {
  const conn = getGatewayConnection();
  await conn.ensureConnected();
  // enabled 是 job 顶层字段（CronCommonOptionalFields）；state 是调度器维护的运行态，不可写
  return conn.request("cron.update", { id: assertJobId(id), patch: { enabled } });
}
