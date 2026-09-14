"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  error?: boolean;
};

type ContentBlock = { type: string; text?: string };

type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  deltaText?: string;
  replace?: boolean;
  message?: { role: string; content: string | ContentBlock[] } | null;
  errorMessage?: string;
  errorKind?: string;
};

type HistoryMessage = {
  role: string;
  content: string | ContentBlock[];
};

const SESSION_STORAGE_KEY = "xiaobei-web:session-key";

// 历史里 user 消息的 content 是纯字符串，assistant 是块数组——两种都要处理
function messageTextOf(message: { content: string | ContentBlock[] } | null | undefined): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("\n");
  }
  return "";
}

function newSessionKey(): string {
  return `web:${crypto.randomUUID()}`;
}

export default function ChatPage() {
  const [sessionKey, setSessionKey] = useState<string>("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [connState, setConnState] = useState<"connecting" | "ready" | "closed">("connecting");
  const sourceRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 消息按 runId 流式更新
  const applyChatEvent = useCallback((payload: ChatEventPayload) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === payload.runId);
      if (payload.state === "delta") {
        const append = payload.deltaText ?? "";
        if (idx >= 0) {
          const next = [...prev];
          const cur = next[idx];
          next[idx] = { ...cur, text: payload.replace ? append : cur.text + append };
          return next;
        }
        return [...prev, { id: payload.runId, role: "assistant", text: append, streaming: true }];
      }
      // 终态：final / aborted / error
      const finalText = messageTextOf(payload.message ?? { content: [] });
      if (idx >= 0) {
        const next = [...prev];
        const cur = next[idx];
        next[idx] = {
          ...cur,
          text: finalText || cur.text || (payload.state === "error" ? payload.errorMessage || "（出错）" : cur.text),
          streaming: false,
          error: payload.state !== "final",
        };
        return next;
      }
      if (payload.state === "final" && finalText) {
        return [...prev, { id: payload.runId, role: "assistant", text: finalText }];
      }
      if (payload.state === "error") {
        return [
          ...prev,
          {
            id: payload.runId,
            role: "assistant",
            text: payload.errorMessage || "（运行出错）",
            error: true,
          },
        ];
      }
      return prev;
    });
    if (payload.state !== "delta") {
      setActiveRunId((cur) => (cur === payload.runId ? null : cur));
    }
  }, []);

  const bindStream = useCallback(
    (key: string) => {
      sourceRef.current?.close();
      const source = new EventSource(`/api/chat/events?sessionKey=${encodeURIComponent(key)}`);
      sourceRef.current = source;
      source.addEventListener("gateway", (evt) => {
        const data = JSON.parse((evt as MessageEvent).data) as {
          state?: "connecting" | "ready" | "closed";
        };
        if (data.state) setConnState(data.state);
      });
      source.addEventListener("chat", (evt) => {
        applyChatEvent(JSON.parse((evt as MessageEvent).data) as ChatEventPayload);
      });
      source.onerror = () => {
        setConnState("connecting"); // EventSource 会自动重连
      };
    },
    [applyChatEvent],
  );

  // 初始化：sessionKey、历史、SSE
  useEffect(() => {
    let key = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!key) {
      key = newSessionKey();
      window.localStorage.setItem(SESSION_STORAGE_KEY, key);
    }
    setSessionKey(key);

    let disposed = false;

    fetch(`/api/chat/history?sessionKey=${encodeURIComponent(key)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("history failed"))))
      .then((data: { messages?: HistoryMessage[] }) => {
        if (disposed || !data.messages?.length) return;
        setMessages(
          data.messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m, i): ChatMsg => ({
              id: `history-${i}`,
              role: m.role === "user" ? "user" : "assistant",
              text: messageTextOf(m),
            }))
            .filter((m) => m.text),
        );
      })
      .catch(() => undefined);

    bindStream(key);

    return () => {
      disposed = true;
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [applyChatEvent, bindStream]);

  // 贴底滚动
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !sessionKey || sending || activeRunId) return;
    setSending(true);
    setInput("");
    const placeholderId = `pending-${crypto.randomUUID()}`;
    // 幂等键在浏览器生成：发送重试必须复用同一 key，gateway 按其去重（runId 即该 key）
    const idempotencyKey = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: placeholderId, role: "user", text },
      { id: `${placeholderId}-a`, role: "assistant", text: "", streaming: true },
    ]);
    const postSend = () =>
      fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey, message: text, idempotencyKey }),
      }).then(async (res) => ({
        ok: res.ok,
        status: res.status,
        data: (await res.json()) as { runId?: string; status?: string; error?: string },
      }));
    try {
      let attempt = await postSend();
      // 回执超时≠发送失败：run 可能已在 gateway 受理并推流。同 key 重试一次，
      // 已受理的经 in_flight 去重拿回 runId，未受理的此刻真正开始——避免"标红失败却开始出字"的自相矛盾
      if (!attempt.ok && attempt.status !== 400 && attempt.status !== 413) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        attempt = await postSend();
      }
      if (!attempt.ok || !attempt.data.runId) {
        throw new Error(attempt.data.error || "发送失败");
      }
      const runId = attempt.data.runId;
      setMessages((prev) => {
        const streamedIdx = prev.findIndex((m) => m.id === runId);
        if (streamedIdx >= 0) {
          // 重试等待期间 run 已推流并自建了消息：丢弃空占位，保留已收到的流
          return prev.filter((m) => m.id !== `${placeholderId}-a`);
        }
        // 占位 assistant 消息改挂到真实 runId（= idempotencyKey）上
        return prev.map((m) => (m.id === `${placeholderId}-a` ? { ...m, id: runId } : m));
      });
      setActiveRunId(runId);
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === `${placeholderId}-a`
            ? {
                ...m,
                text: err instanceof Error ? err.message : "发送失败",
                streaming: false,
                error: true,
              }
            : m,
        ),
      );
    } finally {
      setSending(false);
    }
  }, [input, sessionKey, sending, activeRunId]);

  const abort = useCallback(async () => {
    if (!sessionKey || !activeRunId) return;
    try {
      await fetch("/api/chat/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey, runId: activeRunId }),
      });
    } catch {
      // aborted 事件会由 SSE 推送；此处失败无需额外处理
    }
  }, [sessionKey, activeRunId]);

  const newChat = useCallback(() => {
    const key = newSessionKey();
    window.localStorage.setItem(SESSION_STORAGE_KEY, key);
    setMessages([]);
    setActiveRunId(null);
    setSessionKey(key);
    bindStream(key);
  }, [bindStream]);

  const stateColor =
    connState === "ready"
      ? "bg-green-500"
      : connState === "connecting"
        ? "bg-yellow-500"
        : "bg-red-500";

  return (
    <div className="flex h-dvh flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${stateColor}`} aria-hidden />
          <h1 className="text-base font-semibold">小贝</h1>
          <span className="text-xs text-neutral-500">{sessionKey}</span>
        </div>
        <button
          onClick={newChat}
          className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          新会话
        </button>
        <a
          href="/tasks"
          className="ml-2 rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          控制台
        </a>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {messages.length === 0 && (
            <p className="mt-16 text-center text-sm text-neutral-500">
              与小贝说点什么吧（独立 web 会话，不影响微信侧）
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === "user"
                  ? "max-w-full self-end whitespace-pre-wrap rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-white"
                  : `max-w-full self-start whitespace-pre-wrap rounded-2xl rounded-bl-sm px-4 py-2 ${
                      m.error
                        ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                        : "bg-neutral-100 dark:bg-neutral-800"
                    }`
              }
            >
              {m.text || (m.streaming ? "…" : "")}
              {m.streaming && m.text && <span className="animate-pulse">▍</span>}
            </div>
          ))}
        </div>
      </div>

      <footer className="border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder={activeRunId ? "小贝正在回复…" : "输入消息，Enter 发送，Shift+Enter 换行"}
            className="max-h-40 flex-1 resize-none rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
          {activeRunId ? (
            <button
              onClick={() => void abort()}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              停止
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={sending || !input.trim()}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              发送
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
