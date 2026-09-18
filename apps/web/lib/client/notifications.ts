"use client";

// 完成推送客户端状态层（Phase 4.5 T2）：铃铛（根 layout）与聊天页（指令记录三态）共用。
// 数据全部在 localStorage：终态 outcomes / 已读 readMap / 名册 command-history（Phase 4 建立）。
// 同页组件经 CustomEvent 同步；跨标签经 storage 事件同步（审核 Q5）。

export const OUTCOMES_KEY = "xiaobei-web:command-outcomes";
export const NOTIF_READ_KEY = "xiaobei-web:notif-read";
export const HISTORY_KEY = "xiaobei-web:command-history";
export const OUTCOMES_EVENT = "xiaobei-web:outcomes-updated";

export type CommandOutcomeState = "final" | "error" | "aborted";

export type CommandOutcome = {
  state: CommandOutcomeState;
  endedAt: number;
  runId?: string;
};

export type OutcomeMap = Record<string, CommandOutcome>;
export type ReadMap = Record<string, number>;

export type RosterEntry = {
  id: string;
  commandId: string;
  label: string;
  time: number;
  sessionKey: string;
  observationPage: string | null;
};

const MAX_ENTRIES = 200;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function readOutcomes(): OutcomeMap {
  return readJson<OutcomeMap>(OUTCOMES_KEY, {});
}

// 合并写（读-改-写在同一函数内），返回最新 map 供调用方直接 setState
export function writeOutcome(sessionKey: string, outcome: CommandOutcome): OutcomeMap {
  const prev = readOutcomes();
  const existing = prev[sessionKey];
  // 同一 runId 重复终态（本地回显 + 远端帧）不去重会抖动；旧 runId 的迟到帧不覆盖新 runId
  if (existing && outcome.runId && existing.runId && existing.runId !== outcome.runId) {
    return prev;
  }
  if (existing && existing.runId === outcome.runId && existing.state === outcome.state) {
    return prev;
  }
  const next: OutcomeMap = { ...prev, [sessionKey]: outcome };
  const keys = Object.keys(next);
  if (keys.length > MAX_ENTRIES) {
    for (const k of keys.sort((a, b) => (next[a].endedAt ?? 0) - (next[b].endedAt ?? 0)).slice(0, keys.length - MAX_ENTRIES)) {
      delete next[k];
    }
  }
  try {
    window.localStorage.setItem(OUTCOMES_KEY, JSON.stringify(next));
  } catch {
    // 写失败不影响运行
  }
  notifyOutcomesChanged();
  return next;
}

export function readReadMap(): ReadMap {
  return readJson<ReadMap>(NOTIF_READ_KEY, {});
}

function writeReadMap(map: ReadMap): ReadMap {
  const keys = Object.keys(map);
  if (keys.length > MAX_ENTRIES) {
    for (const k of keys.sort((a, b) => map[a] - map[b]).slice(0, keys.length - MAX_ENTRIES)) {
      delete map[k];
    }
  }
  try {
    window.localStorage.setItem(NOTIF_READ_KEY, JSON.stringify(map));
  } catch {
    // 写失败不影响运行
  }
  return map;
}

export function markSessionRead(sessionKey: string, ts = Date.now()): ReadMap {
  return writeReadMap({ ...readReadMap(), [sessionKey]: ts });
}

export function markAllRead(keys: string[], ts = Date.now()): ReadMap {
  const map = readReadMap();
  for (const k of keys) map[k] = ts;
  return writeReadMap(map);
}

export function isUnread(sessionKey: string, outcome: CommandOutcome, readMap: ReadMap): boolean {
  return outcome.endedAt > (readMap[sessionKey] ?? 0);
}

export function readRoster(): RosterEntry[] {
  return readJson<RosterEntry[]>(HISTORY_KEY, []);
}

// 同会话多条指令只留最新一条（一次委托可能多轮 run，最新终态即该指令结果）
export function latestRosterBySession(entries: RosterEntry[]): RosterEntry[] {
  const byKey = new Map<string, RosterEntry>();
  for (const e of entries) {
    const cur = byKey.get(e.sessionKey);
    if (!cur || e.time > cur.time) byKey.set(e.sessionKey, e);
  }
  return [...byKey.values()];
}

export function notifyOutcomesChanged() {
  window.dispatchEvent(new Event(OUTCOMES_EVENT));
}

export function outcomeLabel(state: CommandOutcomeState): string {
  if (state === "error") return "已出错";
  if (state === "aborted") return "已中止";
  return "已完成";
}
