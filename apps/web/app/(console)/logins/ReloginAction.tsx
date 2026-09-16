"use client";

import { useState } from "react";

import { apiFetch } from "@/lib/client/api";

const MANAGED_PLATFORMS = new Set(["douyin", "kuaishou", "bilibili", "xhs-browse"]);
const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  kuaishou: "快手",
  bilibili: "B 站",
  "xhs-browse": "小红书（浏览）",
};
const COMMAND_HISTORY_KEY = "xiaobei-web:command-history";

function appendHistory(entry: { id: string; platform: string; sessionKey: string; time: number }) {
  try {
    const raw = window.localStorage.getItem(COMMAND_HISTORY_KEY);
    const prev = raw ? (JSON.parse(raw) as unknown[]) : [];
    const { id, platform, sessionKey, time } = entry;
    const next = [
      {
        commandId: "relogin",
        label: `委托重新登录（${PLATFORM_LABELS[platform] ?? platform}）`,
        observationPage: "/logins",
        id,
        sessionKey,
        time,
      },
      ...prev,
    ].slice(0, 100);
    window.localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // 历史写失败不影响本次委托
  }
}

// P4 监控→动作闭环：临期/已过期卡片直接委托 main 的 login-manager 重登流程
export default function ReloginAction({ platform }: { platform: string }) {
  const [busy, setBusy] = useState(false);
  const [sentSession, setSentSession] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!MANAGED_PLATFORMS.has(platform)) {
    return (
      <p className="mt-2 text-[11px] text-neutral-500">
        该平台不在 login-manager 管辖内，请与小贝对话处理。
      </p>
    );
  }

  if (sentSession) {
    return (
      <p className="mt-2 text-[11px]">
        <span className="text-green-700 dark:text-green-400">
          已委托小贝重新登录，稍后会有头浏览器打开登录页，按提示完成手动登录。
        </span>{" "}
        <a
          href={`/?session=${encodeURIComponent(sentSession)}`}
          className="text-blue-600 underline dark:text-blue-400"
        >
          查看会话 →
        </a>
      </p>
    );
  }

  const send = async () => {
    setBusy(true);
    setError(null);
    const idempotencyKey = crypto.randomUUID();
    try {
      const res = await apiFetch("/api/chat/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commandId: "relogin",
          params: { platform },
          idempotencyKey,
        }),
      });
      const data = (await res.json()) as { sessionKey?: string; error?: string };
      if (!res.ok || !data.sessionKey) {
        setError(data.error || "发送失败");
        return;
      }
      appendHistory({ id: idempotencyKey, platform, sessionKey: data.sessionKey, time: Date.now() });
      setSentSession(data.sessionKey);
    } catch {
      setError("发送失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        onClick={() => void send()}
        disabled={busy}
        className="rounded-md border border-amber-600 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-40 dark:border-amber-500 dark:text-amber-400 dark:hover:bg-amber-950"
      >
        {busy ? "发送中…" : "委托重新登录"}
      </button>
      {error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
