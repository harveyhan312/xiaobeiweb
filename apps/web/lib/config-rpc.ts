// gateway config RPC 封装（P3-D）：config.get 读快照（含 baseHash）、
// channel 绑定 patch 的预览与落盘。写路径走 gateway 原生护栏：
// schema 校验、密钥打码还原、baseHash 乐观并发、replacePaths 破坏性意图确认、
// .bak 轮转、重启计划由 gateway 计算返回。
import { GatewayRequestError, getGatewayConnection } from "./gateway";
import {
  buildChannelPatch,
  maskChannelPatchSecrets,
  type ChannelBuildInput,
  type ChannelBuildResult,
} from "./config-templates";

export type ConfigSnapshotSlice = {
  hash?: string;
  exists: boolean;
  valid: boolean;
  bindings?: unknown;
  pluginLoadPaths?: unknown;
  channels?: Record<string, unknown>;
  agentsList?: Array<Record<string, unknown>>;
  modelsProviders?: Record<string, unknown>;
};

type RawSnapshot = {
  exists?: boolean;
  valid?: boolean;
  hash?: string;
  resolved?: Record<string, unknown>;
  runtimeConfig?: Record<string, unknown>;
};

// 读 authored 配置（resolved：磁盘上的 authored 值，未掺运行时默认——patch 合并基准），
// 已由 gateway 打码；bindings/paths/channels 键名均非敏感
export async function fetchConfigSnapshot(): Promise<ConfigSnapshotSlice> {
  const conn = getGatewayConnection();
  await conn.ensureConnected();
  const payload = (await conn.request("config.get", {})) as RawSnapshot;
  const authored = payload.resolved ?? payload.runtimeConfig ?? {};
  return {
    hash: payload.hash,
    exists: payload.exists ?? false,
    valid: payload.valid ?? false,
    bindings: authored.bindings,
    pluginLoadPaths: (authored.plugins as { load?: { paths?: unknown } } | undefined)?.load?.paths,
    channels: authored.channels as Record<string, unknown> | undefined,
    agentsList: (authored.agents as { list?: Array<Record<string, unknown>> } | undefined)?.list ?? [],
    modelsProviders: (authored.models as { providers?: Record<string, unknown> } | undefined)
      ?.providers,
  };
}

function buildOrThrow(input: ChannelBuildInput, snap: ConfigSnapshotSlice): ChannelBuildResult {
  try {
    const feishu = snap.channels?.feishu as { accounts?: unknown } | undefined;
    return buildChannelPatch(input, {
      bindings: snap.bindings,
      pluginLoadPaths: snap.pluginLoadPaths,
      feishuAccounts: feishu?.accounts,
    });
  } catch (err) {
    throw new GatewayRequestError(
      "INVALID_REQUEST",
      err instanceof Error ? err.message : "patch 构建失败",
    );
  }
}

export async function previewChannelBinding(input: ChannelBuildInput): Promise<{
  baseHash?: string;
  patchMasked: Record<string, unknown>;
  replacePaths: string[];
  summary: string[];
  currentChannels: Record<string, unknown> | undefined;
}> {
  const snap = await fetchConfigSnapshot();
  const built = buildOrThrow(input, snap);
  return {
    baseHash: snap.hash,
    patchMasked: maskChannelPatchSecrets(built.patch),
    replacePaths: built.replacePaths,
    summary: built.summary,
    currentChannels: snap.channels,
  };
}

export async function applyChannelBinding(
  input: ChannelBuildInput,
): Promise<{ ok: boolean; restart?: unknown; sentinel?: unknown; note?: string }> {
  const snap = await fetchConfigSnapshot();
  const built = buildOrThrow(input, snap);
  const conn = getGatewayConnection();
  try {
    const payload = (await conn.request("config.patch", {
      raw: JSON.stringify(built.patch),
      ...(snap.hash ? { baseHash: snap.hash } : {}),
      replacePaths: built.replacePaths,
    })) as { restart?: unknown; sentinel?: unknown };
    return { ok: true, restart: payload.restart, sentinel: payload.sentinel };
  } catch (err) {
    // channel 变更会触发 gateway 自动重启，socket 可能在响应送达前被掐断；
    // 写盘实际已发生——用新鲜 config.get 复核，而不是把成功误报为失败。
    // gateway in-process 重启期间连接会持续失败，退避重试至多 ~20s。
    const after = await fetchSnapshotWithRetry(4);
    if (after && channelLanded(after, input) && (!snap.hash || after.hash !== snap.hash)) {
      return {
        ok: true,
        restart: null,
        sentinel: null,
        note: "连接因 gateway 自动重启中断；已通过 config.get 复核写盘成功，restart 计划不可用",
      };
    }
    throw err;
  }
}

export async function fetchSnapshotWithRetry(attempts: number): Promise<ConfigSnapshotSlice | null> {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 3000 * i));
    try {
      return await fetchConfigSnapshot();
    } catch {
      // gateway 重启中，继续退避
    }
  }
  return null;
}

function channelLanded(snap: ConfigSnapshotSlice, input: ChannelBuildInput): boolean {
  const target =
    input.kind === "awada"
      ? (snap.channels?.awada as { enabled?: unknown } | undefined)
      : (snap.channels?.feishu as { enabled?: unknown } | undefined);
  return Boolean(target?.enabled);
}

export async function restartGatewayPreflight(): Promise<unknown> {
  const conn = getGatewayConnection();
  await conn.ensureConnected();
  return conn.request("gateway.restart.preflight", {});
}

// gateway.restart.request 的 delayMs=0，重启可能在响应送达前掐断连接；
// 中断后探测一次 config.get，能连通就视为重启请求已受理。
export async function requestGatewayRestart(): Promise<{
  accepted: boolean;
  result?: unknown;
  note?: string;
}> {
  const conn = getGatewayConnection();
  await conn.ensureConnected();
  try {
    const result = await conn.request("gateway.restart.request", { note: "xiaobei-web 手动重启" });
    return { accepted: true, result };
  } catch (err) {
    // delayMs=0 的重启可能在响应送达前掐断连接；退避探测，能连通即视为已受理
    const probe = await fetchSnapshotWithRetry(4);
    if (probe) {
      return {
        accepted: true,
        note: "重启请求发出后连接中断（重启导致）；gateway 已恢复可连通",
      };
    }
    throw err;
  }
}

// provider 凭证/baseUrl 轮换：patch 走 merge（对象按键合并，未提供的键保留原值，
// 引擎 restoreRedactedValues 负责打码哨兵还原）。仅允许更新已存在的 provider，
// 新建 provider 需 baseUrl+models 完整定义，不在 web 开放。
export async function updateModelProvider(input: {
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
}): Promise<{ ok: boolean; note?: string }> {
  const providerId = input.providerId.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(providerId)) {
    throw new GatewayRequestError("INVALID_REQUEST", "providerId 非法");
  }
  const fields: Record<string, string> = {};
  if (typeof input.apiKey === "string" && input.apiKey.trim() !== "") {
    const apiKey = input.apiKey.trim();
    if (!/^[\x21-\x7e]{8,300}$/.test(apiKey)) {
      throw new GatewayRequestError("INVALID_REQUEST", "apiKey 必须为 8-300 位可见 ASCII 字符");
    }
    fields.apiKey = apiKey;
  }
  if (typeof input.baseUrl === "string" && input.baseUrl.trim() !== "") {
    const baseUrl = input.baseUrl.trim();
    if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
      throw new GatewayRequestError("INVALID_REQUEST", "baseUrl 必须是 http(s) URL");
    }
    fields.baseUrl = baseUrl;
  }
  if (Object.keys(fields).length === 0) {
    throw new GatewayRequestError("INVALID_REQUEST", "需要提供 apiKey 或 baseUrl 至少一项");
  }

  const snap = await fetchConfigSnapshot();
  const providers = snap.modelsProviders ?? {};
  if (!(providerId in providers)) {
    throw new GatewayRequestError(
      "INVALID_REQUEST",
      `provider 不存在: ${providerId}（web 不开放新建 provider）`,
    );
  }
  const conn = getGatewayConnection();
  try {
    await conn.request("config.patch", {
      raw: JSON.stringify({ models: { providers: { [providerId]: fields } } }),
      ...(snap.hash ? { baseHash: snap.hash } : {}),
    });
    return { ok: true };
  } catch (err) {
    const after = await fetchSnapshotWithRetry(4);
    if (after && after.modelsProviders && providerId in after.modelsProviders) {
      return {
        ok: true,
        note: "连接因 gateway 自动重启中断；已通过 config.get 复核写盘成功",
      };
    }
    throw err;
  }
}
