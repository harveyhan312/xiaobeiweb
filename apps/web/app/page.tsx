"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/client/api";

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

type SessionRow = {
  key: string;
  displayName: string | null;
  derivedTitle: string | null;
  lastMessagePreview: string | null;
  updatedAt: number | null;
  hasActiveRun: boolean;
};

type CommandMeta = {
  id: string;
  group: string;
  label: string;
  description: string;
  targetAgentId: string;
  observationPage: string | null;
  params: Array<{
    key: string;
    label: string;
    type: "text" | "choice";
    required: boolean;
    options?: string[];
    description?: string;
    placeholder?: string;
    defaultValue?: string;
  }>;
};

type CommandHistoryItem = {
  id: string;
  commandId: string;
  label: string;
  time: number;
  sessionKey: string;
  observationPage: string | null;
};

const SESSION_STORAGE_KEY = "xiaobei-web:session-key";
const COMMAND_HISTORY_KEY = "xiaobei-web:command-history";

const AGENT_LABELS: Record<string, string> = {
  main: "小贝",
  "content-producer": "视频制作",
  "it-engineer": "系统运维",
};

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

function agentOf(key: string): string | null {
  const m = /^agent:([a-z0-9-]+):web:/.exec(key);
  return m ? m[1] : null;
}

function sessionLabel(s: SessionRow): string {
  const agent = agentOf(s.key);
  const who = agent ? (AGENT_LABELS[agent] ?? agent) : "自由对话";
  if (s.derivedTitle) return `${who} · ${s.derivedTitle}`;
  if (s.displayName) return `${who} · ${s.displayName}`;
  return who;
}

function formatUpdatedAt(ms: number | null): string {
  if (!ms) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export default function ChatPage() {
  const [sessionKey, setSessionKey] = useState<string>("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [connState, setConnState] = useState<"connecting" | "ready" | "closed">("connecting");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sideTab, setSideTab] = useState<"sessions" | "commands">("sessions");
  const [commandHistory, setCommandHistory] = useState<CommandHistoryItem[]>([]);
  // 命令面板：null=关闭；CommandMeta=已选指令（填参数）；string=预览态由 commandPrompt 驱动
  const [panelOpen, setPanelOpen] = useState(false);
  const [commands, setCommands] = useState<CommandMeta[]>([]);
  const [enabledAgents, setEnabledAgents] = useState<string[] | null>(null);
  const [selectedCommand, setSelectedCommand] = useState<CommandMeta | null>(null);
  const [commandParams, setCommandParams] = useState<Record<string, string>>({});
  const [commandPrompt, setCommandPrompt] = useState<string | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [sentReceipt, setSentReceipt] = useState<{ label: string; observationPage: string | null } | null>(null);

  const sourceRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messagesBySession = useRef<Map<string, ChatMsg[]>>(new Map());

  const refreshSessions = useCallback(() => {
    apiFetch("/api/chat/sessions")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("sessions failed"))))
      .then((data: { sessions?: SessionRow[] }) => setSessions(data.sessions ?? []))
      .catch(() => undefined);
  }, []);

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
        setConnState("connecting");
      };
    },
    [applyChatEvent],
  );

  const loadHistory = useCallback((key: string): Promise<ChatMsg[]> => {
    return apiFetch(`/api/chat/history?sessionKey=${encodeURIComponent(key)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("history failed"))))
      .then((data: { messages?: HistoryMessage[] }) =>
        (data.messages ?? [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m, i): ChatMsg => ({
            id: `history-${i}`,
            role: m.role === "user" ? "user" : "assistant",
            text: messageTextOf(m),
          }))
          .filter((m) => m.text),
      )
      .catch(() => [] as ChatMsg[]);
  }, []);

  const switchSession = useCallback(
    (key: string, cached?: ChatMsg[]) => {
      messagesBySession.current.set(sessionKey, messages);
      setSessionKey(key);
      window.localStorage.setItem(SESSION_STORAGE_KEY, key);
      const cachedMsgs = cached ?? messagesBySession.current.get(key) ?? null;
      setMessages(cachedMsgs ?? []);
      setActiveRunId(null);
      bindStream(key);
      if (cachedMsgs === null) {
        void loadHistory(key).then((hist) => {
          messagesBySession.current.set(key, hist);
          setMessages(hist);
        });
      }
    },
    [sessionKey, messages, bindStream, loadHistory],
  );

  useEffect(() => {
    refreshSessions();
    try {
      const raw = window.localStorage.getItem(COMMAND_HISTORY_KEY);
      if (raw) setCommandHistory(JSON.parse(raw) as CommandHistoryItem[]);
    } catch {
      // 历史损坏则从空开始
    }
    // /logins 等页深链 ?session=<key>：直接进入该会话并记住为当前会话
    const urlSession = new URLSearchParams(window.location.search).get("session");
    let key = urlSession ?? window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!key) {
      key = newSessionKey();
      window.localStorage.setItem(SESSION_STORAGE_KEY, key);
    }
    if (urlSession) window.localStorage.setItem(SESSION_STORAGE_KEY, urlSession);
    const activeKey: string = key;
    setSessionKey(activeKey);
    bindStream(activeKey);
    void loadHistory(activeKey).then((hist) => {
      messagesBySession.current.set(activeKey, hist);
      setMessages(hist);
    });
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const openCommandPanel = useCallback(() => {
    setPanelOpen(true);
    setCommandError(null);
    setSentReceipt(null);
    if (commands.length === 0) {
      apiFetch("/api/chat/commands")
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("commands failed"))))
        .then((data: { commands?: CommandMeta[] }) => setCommands(data.commands ?? []))
        .catch(() => setCommandError("指令目录加载失败"));
    }
    // P3：停用前置门控——目标 agent 不在 crews 列表时卡片置灰
    apiFetch("/api/config/crews")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("crews failed"))))
      .then((data: { enabled?: Array<{ id?: string }> }) =>
        setEnabledAgents((data.enabled ?? []).map((c) => String(c.id ?? "")).filter(Boolean)),
      )
      .catch(() => setEnabledAgents(null));
  }, [commands.length]);

  const closeCommandPanel = useCallback(() => {
    setPanelOpen(false);
    setSelectedCommand(null);
    setCommandParams({});
    setCommandPrompt(null);
    setCommandError(null);
    setSentReceipt(null);
  }, []);

  const previewCommand = useCallback(async () => {
    if (!selectedCommand) return;
    setCommandBusy(true);
    setCommandError(null);
    try {
      const res = await apiFetch("/api/chat/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandId: selectedCommand.id, params: commandParams, dryRun: true }),
      });
      const data = (await res.json()) as { prompt?: string; error?: string };
      if (!res.ok || !data.prompt) {
        setCommandError(data.error || "预览失败");
        return;
      }
      setCommandPrompt(data.prompt);
    } finally {
      setCommandBusy(false);
    }
  }, [selectedCommand, commandParams]);

  const sendCommand = useCallback(async () => {
    if (!selectedCommand || !commandPrompt) return;
    setCommandBusy(true);
    setCommandError(null);
    const idempotencyKey = crypto.randomUUID();
    try {
      const res = await apiFetch("/api/chat/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commandId: selectedCommand.id,
          params: commandParams,
          idempotencyKey,
        }),
      });
      const data = (await res.json()) as {
        sessionKey?: string;
        runId?: string;
        error?: string;
        observationHint?: { page?: string | null };
      };
      if (!res.ok || !data.sessionKey) {
        setCommandError(data.error || "发送失败");
        return;
      }
      const targetKey = data.sessionKey;
      const promptShown = commandPrompt;
      // P2：指令记录存 localStorage（跨设备一致需引擎侧支持，v2）
      const historyItem: CommandHistoryItem = {
        id: idempotencyKey,
        commandId: selectedCommand.id,
        label: selectedCommand.label,
        time: Date.now(),
        sessionKey: targetKey,
        observationPage: data.observationHint?.page ?? selectedCommand.observationPage ?? null,
      };
      setCommandHistory((prev) => {
        const next = [historyItem, ...prev].slice(0, 100);
        try {
          window.localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(next));
        } catch {
          // 存储满等异常不影响本次委托
        }
        return next;
      });
      messagesBySession.current.delete(targetKey);
      // P1：面板切到回执态（直达观测页链接），会话在面板后方已切换
      setSentReceipt({ label: selectedCommand.label, observationPage: historyItem.observationPage });
      setSelectedCommand(null);
      setCommandParams({});
      setCommandPrompt(null);
      switchSession(targetKey, [
        { id: `cmd-${idempotencyKey}`, role: "user", text: promptShown },
        { id: `${idempotencyKey}-pending`, role: "assistant", text: "", streaming: true },
      ]);
      setMessages((prev) =>
        prev.map((m) => (m.id === `${idempotencyKey}-pending` ? { ...m, id: idempotencyKey } : m)),
      );
      setActiveRunId(data.runId ?? idempotencyKey);
      refreshSessions();
    } catch {
      setCommandError("发送失败");
    } finally {
      setCommandBusy(false);
    }
  }, [selectedCommand, commandPrompt, commandParams, switchSession, refreshSessions]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !sessionKey || sending || activeRunId) return;
    setSending(true);
    setInput("");
    const placeholderId = `pending-${crypto.randomUUID()}`;
    const idempotencyKey = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: placeholderId, role: "user", text },
      { id: `${placeholderId}-a`, role: "assistant", text: "", streaming: true },
    ]);
    const postSend = () =>
      apiFetch("/api/chat/send", {
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
          return prev.filter((m) => m.id !== `${placeholderId}-a`);
        }
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
      await apiFetch("/api/chat/abort", {
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

  const activeAgent = agentOf(sessionKey);
  // 裸 web:<uuid> 与其 canonical 形态（agent:<main>:web:<uuid>）是同一会话，避免列表重复
  const isSameSession = (a: string, b: string) =>
    a === b || a.endsWith(`:${b}`) || b.endsWith(`:${a}`);
  const activeInList = sessions.some((s) => isSameSession(s.key, sessionKey));
  const sessionList = activeInList
    ? sessions
    : [
        { key: sessionKey, displayName: null, derivedTitle: null, lastMessagePreview: null, updatedAt: null, hasActiveRun: false },
        ...sessions,
      ];
  const grouped = commands.reduce<Record<string, CommandMeta[]>>((acc, c) => {
    (acc[c.group] ??= []).push(c);
    return acc;
  }, {});
  const requiredMissing = selectedCommand
    ? selectedCommand.params.some((p) => p.required && !(commandParams[p.key] ?? "").trim())
    : false;

  return (
    <div className="flex h-dvh bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      {/* 会话侧栏 */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-2 px-3 py-3">
          <span className={`h-2.5 w-2.5 rounded-full ${stateColor}`} aria-hidden />
          <span className="text-sm font-semibold">小贝</span>
        </div>
        <div className="flex gap-2 px-3 pb-2">
          <button
            onClick={newChat}
            className="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            新会话
          </button>
          <button
            onClick={openCommandPanel}
            className="flex-1 rounded-md bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            快捷指令
          </button>
        </div>
        <div className="flex gap-1 border-b border-neutral-200 px-3 dark:border-neutral-800">
          {(["sessions", "commands"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setSideTab(t)}
              className={`px-2 py-1.5 text-xs ${
                sideTab === t
                  ? "border-b-2 border-blue-600 font-medium text-blue-600"
                  : "text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
              }`}
            >
              {t === "sessions" ? "会话" : "指令记录"}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {sideTab === "sessions" &&
            sessionList.map((s) => (
              <button
                key={s.key}
                onClick={() => s.key !== sessionKey && switchSession(s.key)}
                className={`mb-1 w-full rounded-md px-2 py-2 text-left text-xs ${
                  isSameSession(s.key, sessionKey)
                    ? "bg-neutral-200 dark:bg-neutral-800"
                    : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate font-medium">{sessionLabel(s)}</span>
                  {s.hasActiveRun && (
                    <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-green-500" title="运行中" />
                  )}
                </div>
                {s.lastMessagePreview && (
                  <div className="mt-0.5 truncate text-neutral-500">{s.lastMessagePreview}</div>
                )}
                {s.updatedAt && (
                  <div className="mt-0.5 text-neutral-400">{formatUpdatedAt(s.updatedAt)}</div>
                )}
              </button>
            ))}
          {sideTab === "commands" &&
            (commandHistory.length === 0 ? (
              <p className="px-2 py-4 text-xs text-neutral-500">
                还没有委托过指令。点上方「快捷指令」发起。
              </p>
            ) : (
              commandHistory.map((h) => (
                <div key={h.id} className="mb-1 rounded-md px-2 py-2 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate font-medium">{h.label}</span>
                    <span className="shrink-0 text-neutral-400">{formatUpdatedAt(h.time)}</span>
                  </div>
                  <div className="mt-1 flex gap-2">
                    <button
                      onClick={() => switchSession(h.sessionKey)}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      进入会话
                    </button>
                    {h.observationPage && (
                      <a href={h.observationPage} className="text-blue-600 hover:underline dark:text-blue-400">
                        去{h.observationPage}查看
                      </a>
                    )}
                  </div>
                </div>
              ))
            ))}
        </div>
        <a
          href="/tasks"
          className="border-t border-neutral-200 px-3 py-2.5 text-xs text-neutral-500 hover:text-neutral-900 dark:border-neutral-800 dark:hover:text-white"
        >
          控制台 →
        </a>
      </aside>

      {/* 主对话区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold">
              {activeAgent ? (AGENT_LABELS[activeAgent] ?? activeAgent) : "自由对话"}
            </h1>
            {activeAgent && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                快捷指令会话
              </span>
            )}
            <span className="font-mono text-xs text-neutral-400">{sessionKey}</span>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-3">
            {messages.length === 0 && (
              <p className="mt-16 text-center text-sm text-neutral-500">
                与小贝说点什么，或从左侧「快捷指令」发起标准任务（独立 web 会话，不影响微信侧）
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

      {/* 快捷指令面板 */}
      {panelOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeCommandPanel}
          role="presentation"
        >
          <div
            className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="快捷指令"
          >
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <h2 className="text-sm font-semibold">
                {sentReceipt ? "委托已发送" : selectedCommand ? selectedCommand.label : "快捷指令"}
              </h2>
              <button
                onClick={closeCommandPanel}
                className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
              >
                关闭
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {sentReceipt ? (
                <div>
                  <p className="text-sm">
                    已发送委托：<span className="font-medium">{sentReceipt.label}</span>。已切换到对应会话，回复会实时出现。
                  </p>
                  <p className="mt-2 text-xs text-neutral-500">
                    长程任务（视频等）完成时间由 agent 节奏决定，可随时去观测页查看产物。
                  </p>
                  <div className="mt-3 flex gap-2">
                    {sentReceipt.observationPage && (
                      <a
                        href={sentReceipt.observationPage}
                        className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                      >
                        去 {sentReceipt.observationPage} 查看 →
                      </a>
                    )}
                    <button
                      onClick={closeCommandPanel}
                      className="rounded-lg border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    >
                      留在会话
                    </button>
                  </div>
                </div>
              ) : (
              <>
              {!selectedCommand &&
                Object.entries(grouped).map(([group, items]) => (
                  <div key={group} className="mb-3">
                    <div className="mb-1.5 text-xs text-neutral-400">{group}</div>
                    <div className="flex flex-col gap-1.5">
                      {items.map((c) => {
                        const disabledTarget =
                          enabledAgents !== null && !enabledAgents.includes(c.targetAgentId);
                        return (
                          <button
                            key={c.id}
                            disabled={disabledTarget}
                            onClick={() => {
                              setSelectedCommand(c);
                              const defaults: Record<string, string> = {};
                              for (const p of c.params) {
                                if (p.defaultValue) defaults[p.key] = p.defaultValue;
                              }
                              setCommandParams(defaults);
                              setCommandPrompt(null);
                              setCommandError(null);
                            }}
                            className={`rounded-lg border px-3 py-2 text-left ${
                              disabledTarget
                                ? "cursor-not-allowed border-neutral-200 opacity-50 dark:border-neutral-800"
                                : "border-neutral-200 hover:border-blue-400 dark:border-neutral-800 dark:hover:border-blue-600"
                            }`}
                          >
                            <div className="text-sm font-medium">{c.label}</div>
                            <div className="mt-0.5 text-xs text-neutral-500">{c.description}</div>
                            {disabledTarget && (
                              <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                                目标 agent 已停用，需先到{" "}
                                <a href="/config" className="underline">配置总览</a> 启用
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

              {selectedCommand && (
                <div>
                  <p className="mb-3 text-xs text-neutral-500">
                    发给「{AGENT_LABELS[selectedCommand.targetAgentId] ?? selectedCommand.targetAgentId}」执行，产物在控制台对应页面观测。
                  </p>
                  <div className="flex flex-col gap-2.5">
                    {selectedCommand.params.map((p) => {
                      const val = commandParams[p.key] ?? "";
                      const missing = p.required && !val.trim();
                      return (
                        <label key={p.key} className="block">
                          <span className="mb-1 block text-xs">
                            {p.label}
                            {p.required && <span className="text-red-500"> *</span>}
                          </span>
                          {p.type === "choice" ? (
                            <select
                              value={val}
                              onChange={(e) => setCommandParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                              className={`w-full rounded-md border px-2 py-1.5 text-sm ${
                                missing
                                  ? "border-red-400 dark:border-red-500"
                                  : "border-neutral-300 dark:border-neutral-700"
                              } dark:bg-neutral-900`}
                            >
                              <option value="">请选择…</option>
                              {(p.options ?? []).map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              value={val}
                              onChange={(e) => setCommandParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                              placeholder={p.placeholder}
                              className={`w-full rounded-md border px-2 py-1.5 text-sm ${
                                missing
                                  ? "border-red-400 dark:border-red-500"
                                  : "border-neutral-300 dark:border-neutral-700"
                              } dark:bg-neutral-900`}
                            />
                          )}
                          {p.description && (
                            <span className="mt-0.5 block text-[11px] text-neutral-500">{p.description}</span>
                          )}
                          {missing && (
                            <span className="mt-0.5 block text-[11px] text-red-500">该项为必填</span>
                          )}
                        </label>
                      );
                    })}
                  </div>

                  {commandPrompt && (
                    <>
                      <pre className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-neutral-100 px-3 py-2 text-xs dark:bg-neutral-800">
                        {commandPrompt}
                      </pre>
                      <p className="mt-1 text-[11px] text-neutral-500">
                        将以此委托 agent，实际执行方式由 agent 判断。
                      </p>
                    </>
                  )}
                  {commandError && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">{commandError}</p>
                  )}
                </div>
              )}
              </>
              )}
            </div>

            {!sentReceipt && selectedCommand && (
              <div className="flex justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
                {!commandPrompt ? (
                  <button
                    onClick={() => void previewCommand()}
                    disabled={commandBusy || requiredMissing}
                    title={requiredMissing ? "请先填写必填项" : undefined}
                    className="rounded-lg border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    {commandBusy ? "…" : requiredMissing ? "预览（必填项未填）" : "预览"}
                  </button>
                ) : (
                  <button
                    onClick={() => void sendCommand()}
                    disabled={commandBusy}
                    className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                  >
                    {commandBusy ? "…" : "发送委托"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
