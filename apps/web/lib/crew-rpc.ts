// crew（agent）启停 RPC 封装（P3-E）：
// 启用 = 渲染 workspace 下的 openclaw_setting_sample.json 并 patch 进 agents.list（id-keyed merge 新增）；
// 停用 = 从 agents.list 移除 entry（整体替换需 replacePaths 声明），workspace 与数据保留。
// 产品语义出处：docs/sales-cs-bootstrap.md 停用流程、crews/main/AGENTS.md「crew 管理」。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { GatewayRequestError, getGatewayConnection } from "./gateway";
import { fetchConfigSnapshot, fetchSnapshotWithRetry, type ConfigSnapshotSlice } from "./config-rpc";

// main 是默认 crew（bootstrap），it-engineer 是全局支撑 crew（生命周期不受 crew 管理，
// crews/main/AGENTS.md）；web 不开放对两者的停用。
const PROTECTED_AGENT_IDS = new Set(["main", "it-engineer"]);

const CREW_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

function stateDir(): string {
  return process.env.OPENCLAW_STATE_DIR ?? join(homedir(), ".openclaw");
}

export type CrewSampleInfo = { id: string; name: string; skills: number };

// 扫描 ~/.openclaw/workspace-*/openclaw_setting_sample.json（部署时已就位）
export function listCrewSamples(): CrewSampleInfo[] {
  const dir = stateDir();
  if (!existsSync(dir)) return [];
  const samples: CrewSampleInfo[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("workspace-")) continue;
    const samplePath = join(dir, entry.name, "openclaw_setting_sample.json");
    if (!existsSync(samplePath)) continue;
    try {
      const sample = JSON.parse(readFileSync(samplePath, "utf8")) as {
        id?: unknown;
        name?: unknown;
        skills?: unknown;
      };
      if (typeof sample.id !== "string" || !CREW_ID_RE.test(sample.id)) continue;
      samples.push({
        id: sample.id,
        name: typeof sample.name === "string" ? sample.name : sample.id,
        skills: Array.isArray(sample.skills) ? sample.skills.length : 0,
      });
    } catch {
      // 无法解析的 sample 跳过，不阻塞列表
    }
  }
  return samples;
}

// 渲染 sample：唯一占位符 {path_to_.openclaw} 指向状态目录
function renderCrewSample(id: string): Record<string, unknown> {
  const samplePath = join(stateDir(), `workspace-${id}`, "openclaw_setting_sample.json");
  if (!existsSync(samplePath)) {
    throw new GatewayRequestError("INVALID_REQUEST", `未找到 crew sample: ${id}`);
  }
  const raw = readFileSync(samplePath, "utf8").replaceAll("{path_to_.openclaw}", stateDir());
  const rendered = JSON.parse(raw) as Record<string, unknown>;
  if (rendered.id !== id) {
    throw new GatewayRequestError("INVALID_REQUEST", `sample id 与请求不一致: ${rendered.id}`);
  }
  return rendered;
}

export type CrewStates = {
  enabled: Array<{ id: string; name?: string; model?: string; protected: boolean }>;
  available: CrewSampleInfo[];
};

export function deriveCrewStates(snap: ConfigSnapshotSlice): CrewStates {
  const enabled = (snap.agentsList ?? []).map((a) => ({
    id: String(a.id ?? ""),
    name: typeof a.name === "string" ? a.name : undefined,
    model: typeof a.model === "string" ? a.model : undefined,
    protected: PROTECTED_AGENT_IDS.has(String(a.id ?? "")),
  }));
  const enabledIds = new Set(enabled.map((a) => a.id));
  const available = listCrewSamples().filter((s) => !enabledIds.has(s.id));
  return { enabled, available };
}

export async function enableCrew(id: string): Promise<{ ok: boolean; note?: string }> {
  if (!CREW_ID_RE.test(id)) {
    throw new GatewayRequestError("INVALID_REQUEST", "crew id 非法");
  }
  const snap = await fetchConfigSnapshot();
  if ((snap.agentsList ?? []).some((a) => a.id === id)) {
    throw new GatewayRequestError("INVALID_REQUEST", `crew 已启用: ${id}`);
  }
  const entry = renderCrewSample(id);
  const conn = getGatewayConnection();
  try {
    await conn.request("config.patch", {
      raw: JSON.stringify({ agents: { list: [entry] } }),
      ...(snap.hash ? { baseHash: snap.hash } : {}),
    });
    return { ok: true };
  } catch (err) {
    const after = await fetchSnapshotWithRetry(4);
    if (after && (after.agentsList ?? []).some((a) => a.id === id)) {
      return { ok: true, note: "连接因 gateway 自动重启中断；已复核 agents.list 写盘成功" };
    }
    throw err;
  }
}

export async function disableCrew(id: string): Promise<{ ok: boolean; note?: string }> {
  if (!CREW_ID_RE.test(id)) {
    throw new GatewayRequestError("INVALID_REQUEST", "crew id 非法");
  }
  if (PROTECTED_AGENT_IDS.has(id)) {
    throw new GatewayRequestError("INVALID_REQUEST", `${id} 为受保护 crew，不可停用`);
  }
  const snap = await fetchConfigSnapshot();
  const kept = (snap.agentsList ?? []).filter((a) => a.id !== id);
  if (kept.length === (snap.agentsList ?? []).length) {
    throw new GatewayRequestError("INVALID_REQUEST", `crew 未启用: ${id}`);
  }
  // 停用前检查配置内的引用，避免悬空路由
  const bindings = Array.isArray(snap.bindings) ? (snap.bindings as Array<Record<string, unknown>>) : [];
  const bindingRefs = bindings.filter((b) => b.agentId === id).length;
  const channels = snap.channels ?? {};
  const awadaCustomerDb = (channels.awada as { config?: { customerdb?: { agentId?: unknown } } })
    ?.config?.customerdb?.agentId;
  const refs: string[] = [];
  if (bindingRefs > 0) refs.push(`bindings 中 ${bindingRefs} 条路由指向 ${id}`);
  if (awadaCustomerDb === id) refs.push(`channels.awada.config.customerdb.agentId=${id}`);
  if (refs.length > 0) {
    throw new GatewayRequestError(
      "INVALID_REQUEST",
      `存在对 ${id} 的引用，请先解除：${refs.join("；")}`,
    );
  }
  const conn = getGatewayConnection();
  try {
    await conn.request("config.patch", {
      raw: JSON.stringify({ agents: { list: kept } }),
      ...(snap.hash ? { baseHash: snap.hash } : {}),
      replacePaths: ["agents.list"],
    });
    return { ok: true };
  } catch (err) {
    const after = await fetchSnapshotWithRetry(4);
    if (after && !(after.agentsList ?? []).some((a) => a.id === id)) {
      return { ok: true, note: "连接因 gateway 自动重启中断；已复核 agents.list 写盘成功" };
    }
    throw err;
  }
}

// per-agent 模型分配：引擎 agents.update RPC（v2026.7.1 已无计划文档里的
// agents.defaults.modelPolicy.allow 字段，此处按现行 schema 实现）
export async function setAgentModel(input: {
  agentId: string;
  model: string;
}): Promise<unknown> {
  const agentId = input.agentId.trim();
  const model = input.model.trim();
  if (!CREW_ID_RE.test(agentId)) {
    throw new GatewayRequestError("INVALID_REQUEST", "agentId 非法");
  }
  if (!/^[\w.:/-]{2,200}$/.test(model)) {
    throw new GatewayRequestError("INVALID_REQUEST", "model 引用格式非法");
  }
  const conn = getGatewayConnection();
  await conn.ensureConnected();
  return conn.request("agents.update", { agentId, model });
}

export { PROTECTED_AGENT_IDS };
