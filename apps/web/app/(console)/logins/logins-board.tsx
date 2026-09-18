"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/client/api";
import type { LoginStatus } from "@/lib/xiaobei-logins";
import { PROBE_PLATFORMS, type ProbeResult } from "@/lib/probe-shared";

import ReloginAction from "./ReloginAction";
import { ALERT_STATES, PLATFORM_LABELS, STATE_META, type CardState } from "./login-meta";

type ProbeCell = { loading: boolean; result: ProbeResult | null };

function formatCheckedAt(ms: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

// 与 lib/xiaobei-data 的 formatMs 同款展示；不直接 import——该库含 node:fs，会污染客户端 bundle
function formatMs(ms: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export default function LoginsBoard({ statuses }: { statuses: LoginStatus[] }) {
  const [probes, setProbes] = useState<Record<string, ProbeCell>>({});

  const probe = useCallback(async (platform: string) => {
    setProbes((prev) => ({
      ...prev,
      [platform]: { loading: true, result: prev[platform]?.result ?? null },
    }));
    try {
      const res = await apiFetch("/api/logins/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const data = (await res.json()) as { result?: ProbeResult; error?: string };
      const result: ProbeResult =
        res.ok && data.result
          ? data.result
          : {
              platform,
              serverState: "probe-unavailable",
              reason: data.error || "探测请求失败",
              checkedAt: Date.now(),
            };
      setProbes((prev) => ({ ...prev, [platform]: { loading: false, result } }));
    } catch {
      setProbes((prev) => ({
        ...prev,
        [platform]: {
          loading: false,
          result: {
            platform,
            serverState: "probe-unavailable",
            reason: "探测请求失败",
            checkedAt: Date.now(),
          },
        },
      }));
    }
  }, []);

  // 进入页面自动探测本地预警平台（脚本侧 10min TTL 缓存防签名放大）；仅挂载跑一次，手动重探走按钮
  useEffect(() => {
    for (const s of statuses) {
      if (
        (s.state === "expired" || s.state === "expiring") &&
        (PROBE_PLATFORMS as readonly string[]).includes(s.platform)
      ) {
        void probe(s.platform);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {statuses.map((s) => {
        const cell = probes[s.platform];
        const probeable = (PROBE_PLATFORMS as readonly string[]).includes(s.platform);
        // 探活结论优先于本地判定：服务端失效即使本地未过期也按第六状态呈现
        const effective: CardState =
          cell?.result?.serverState === "server-expired" ? "server-expired" : s.state;
        const meta = STATE_META[effective];
        return (
          <div key={s.platform} className={`rounded-lg border p-4 ${meta.cls}`}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{PLATFORM_LABELS[s.platform] ?? s.platform}</div>
              <span className="flex items-center gap-1.5 text-xs">
                <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden />
                {meta.label}
              </span>
            </div>
            <div className="mt-2 space-y-1 text-xs text-neutral-600 dark:text-neutral-400">
              <div>最近更新：{s.updatedAt ? formatTime(s.updatedAt) : "—"}</div>
              <div>
                最近过期：{s.maxExpiresAtMs ? formatMs(s.maxExpiresAtMs) : s.sessionOnly ? "会话 cookie（无法本地预警）" : "—"}
              </div>
              <div className="truncate" title={s.cookieNames.join(", ")}>
                关键 cookie：{s.cookieNames.length > 0 ? s.cookieNames.join(", ") : "无"}
              </div>
            </div>
            {probeable && (
              <div className="mt-2 text-xs">
                {cell?.loading ? (
                  <span className="text-neutral-500">服务端探活：探测中…</span>
                ) : cell?.result ? (
                  cell.result.serverState === "valid" ? (
                    <span className="text-green-700 dark:text-green-400">
                      服务端探活：有效（{formatCheckedAt(cell.result.checkedAt)}）
                    </span>
                  ) : cell.result.serverState === "server-expired" ? (
                    <span className="text-red-700 dark:text-red-400">
                      服务端已失效：{cell.result.reason}
                    </span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400">
                      探测不可用：{cell.result.reason}
                    </span>
                  )
                ) : (
                  <button
                    onClick={() => void probe(s.platform)}
                    className="rounded-md border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    服务端探测
                  </button>
                )}
                {cell?.result && !cell.loading && (
                  <button
                    onClick={() => void probe(s.platform)}
                    className="ml-2 text-[11px] text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200"
                  >
                    重新探测
                  </button>
                )}
              </div>
            )}
            {(ALERT_STATES.includes(s.state) || effective === "server-expired") && (
              <ReloginAction platform={s.platform} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return formatMs(ms);
}
