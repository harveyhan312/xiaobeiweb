"use client";

// 完成推送铃铛（Phase 4.5 T2，审核 Q1：挂根 layout 覆盖 chat 页 + console 全部页面）。
// 数据源：sessions-events SSE（chat 终态=主信号，sessions.changed false 沿=兜底）+
// localStorage 名册/终态/已读。只对指令名册内的会话提醒，渠道会话已在 BFF 过滤。

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/client/api";
import {
  isUnread,
  latestRosterBySession,
  markAllRead,
  markSessionRead,
  NOTIF_READ_KEY,
  outcomeLabel,
  OUTCOMES_EVENT,
  readOutcomes,
  readRoster,
  readReadMap,
  writeOutcome,
  type CommandOutcome,
  type OutcomeMap,
  type RosterEntry,
  type ReadMap,
} from "@/lib/client/notifications";

type SessionRow = { key: string; hasActiveRun: boolean; updatedAt: number | null };

type NotifyItem = RosterEntry & {
  outcome: CommandOutcome | null;
  running: boolean;
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomeMap>({});
  const [readMap, setReadMap] = useState<ReadMap>({});
  const [runningKeys, setRunningKeys] = useState<Set<string>>(new Set());
  const activeSeenRef = useRef<Set<string>>(new Set());
  const rosterKeysRef = useRef<Set<string>>(new Set());

  const refreshRoster = useCallback(() => {
    const entries = readRoster();
    setRoster(entries);
    rosterKeysRef.current = new Set(entries.map((e) => e.sessionKey));
  }, []);

  // Q6：打开即校准一次运行态（不限铃铛展开）
  const calibrateRunning = useCallback(async () => {
    try {
      const res = await apiFetch("/api/chat/sessions");
      if (!res.ok) return;
      const data = (await res.json()) as { sessions?: SessionRow[] };
      const next = new Set<string>();
      for (const s of data.sessions ?? []) {
        if (s.hasActiveRun) next.add(s.key);
      }
      setRunningKeys(next);
    } catch {
      // 校准失败不影响 SSE 实时流
    }
  }, []);

  useEffect(() => {
    refreshRoster();
    setOutcomes(readOutcomes());
    setReadMap(readReadMap());
    void calibrateRunning();

    const source = new EventSource("/api/chat/sessions-events");
    source.addEventListener("session", (evt) => {
      const p = JSON.parse((evt as MessageEvent).data) as {
        sessionKey: string;
        hasActiveRun: boolean;
        ts?: number;
      };
      if (!rosterKeysRef.current.has(p.sessionKey)) return;
      const next = new Set(activeSeenRef.current);
      if (p.hasActiveRun) {
        next.add(p.sessionKey);
        activeSeenRef.current = next;
        setRunningKeys((prev) => new Set(prev).add(p.sessionKey));
        return;
      }
      next.delete(p.sessionKey);
      activeSeenRef.current = next;
      setRunningKeys((prev) => {
        const n = new Set(prev);
        n.delete(p.sessionKey);
        return n;
      });
      // false 沿但终态缺失（重连等场景，T1：终态先于完成沿到达）：兜底按已完成，
      // 若随后终态到达以终态为准（writeOutcome 允许覆盖同 runId 不同状态）
      if (!readOutcomes()[p.sessionKey]) {
        setOutcomes(
          writeOutcome(p.sessionKey, { state: "final", endedAt: p.ts ?? Date.now() }),
        );
      }
    });
    source.addEventListener("chat-terminal", (evt) => {
      const p = JSON.parse((evt as MessageEvent).data) as {
        sessionKey: string;
        runId: string;
        state: "final" | "error" | "aborted";
      };
      if (!rosterKeysRef.current.has(p.sessionKey)) return;
      setOutcomes(
        writeOutcome(p.sessionKey, { state: p.state, endedAt: Date.now(), runId: p.runId }),
      );
      setRunningKeys((prev) => {
        const n = new Set(prev);
        n.delete(p.sessionKey);
        return n;
      });
    });
    source.onerror = () => {
      // EventSource 自动重连；订阅是连接级幂等操作，重连后 SSE route 会重新 subscribe
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === NOTIF_READ_KEY) setReadMap(readReadMap());
    };
    const onOutcomes = () => {
      setOutcomes(readOutcomes());
      refreshRoster();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(OUTCOMES_EVENT, onOutcomes);
    return () => {
      source.close();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(OUTCOMES_EVENT, onOutcomes);
    };
  }, [refreshRoster, calibrateRunning]);

  // Q6：铃铛展开期间 30s 轮询兜底
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => void calibrateRunning(), 30_000);
    return () => clearInterval(t);
  }, [open, calibrateRunning]);

  const items: NotifyItem[] = latestRosterBySession(roster)
    .map((e) => ({
      ...e,
      outcome: outcomes[e.sessionKey] ?? null,
      running: runningKeys.has(e.sessionKey),
    }))
    .sort((a, b) => (b.outcome?.endedAt ?? b.time) - (a.outcome?.endedAt ?? a.time))
    .slice(0, 20);

  const unreadCount = items.filter(
    (i) => i.outcome && !i.running && isUnread(i.sessionKey, i.outcome, readMap),
  ).length;

  const openItem = (item: NotifyItem) => {
    if (item.outcome) setReadMap(markSessionRead(item.sessionKey, Date.now()));
    window.location.href = `/?session=${encodeURIComponent(item.sessionKey)}`;
  };

  return (
    <div className="fixed right-4 top-4 z-40">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`任务通知（${unreadCount} 条未读）`}
        className="relative rounded-full border border-neutral-200 bg-white p-2 shadow-sm hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute right-0 mt-2 w-80 rounded-xl border border-neutral-200 bg-white p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
          role="dialog"
          aria-label="任务通知"
        >
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-semibold">任务通知</span>
            {unreadCount > 0 && (
              <button
                onClick={() => setReadMap(markAllRead(items.map((i) => i.sessionKey)))}
                className="text-[11px] text-blue-600 hover:underline dark:text-blue-400"
              >
                全部已读
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-2 py-4 text-xs text-neutral-500">
              还没有委托过指令。在聊天页「快捷指令」发起后，完成/出错会在这里提醒。
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {items.map((item) => {
                const unread = item.outcome && !item.running && isUnread(item.sessionKey, item.outcome, readMap);
                const dot = item.running
                  ? "bg-green-500 animate-pulse"
                  : item.outcome?.state === "error" || item.outcome?.state === "aborted"
                    ? "bg-red-500"
                    : "bg-green-500";
                return (
                  <div
                    key={item.sessionKey}
                    className={`rounded-lg px-2 py-2 text-xs ${unread ? "bg-blue-50 dark:bg-blue-950/40" : "hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
                      <span className="truncate font-medium">{item.label}</span>
                      <span className="ml-auto shrink-0 text-neutral-400">
                        {item.running
                          ? "进行中"
                          : item.outcome
                            ? outcomeLabel(item.outcome.state)
                            : ""}
                      </span>
                    </div>
                    <div className="mt-1 flex gap-2">
                      <button
                        onClick={() => openItem(item)}
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        进入会话
                      </button>
                      {item.observationPage && (
                        <a
                          href={item.observationPage}
                          className="text-blue-600 hover:underline dark:text-blue-400"
                        >
                          去{item.observationPage}查看
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
