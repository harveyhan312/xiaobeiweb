"use client";

import { useCallback, useEffect, useState } from "react";

type CrewEnabled = { id: string; name?: string; model?: string; protected: boolean };
type CrewAvailable = { id: string; name: string; skills: number };
type CrewStates = { enabled: CrewEnabled[]; available: CrewAvailable[] };
type ProviderInfo = { id: string; baseUrl: string | null };
type CronJob = {
  id: string;
  name: string;
  agentId?: string;
  enabled: boolean;
  schedule?: { kind?: string; everyMs?: number; expression?: string; at?: string };
  payloadKind?: string;
  lastRunStatus?: string;
};

const BTN_CLS =
  "rounded border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800";
const INPUT_CLS =
  "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900";
const CARD_CLS = "rounded-lg border border-neutral-200 p-4 dark:border-neutral-800";
const ERR_CLS =
  "mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300";
const OK_CLS =
  "mt-2 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300";

async function apiPost(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new Error(String(data?.error ?? `HTTP ${res.status}`));
  return data ?? {};
}

function ScheduleLabel({ job }: { job: CronJob }) {
  const s = job.schedule ?? {};
  if (s.kind === "every") return <span>每 {Math.round((s.everyMs ?? 0) / 60000)} 分钟</span>;
  if (s.kind === "cron") return <span>cron: {s.expression}</span>;
  if (s.kind === "at") return <span>一次性: {s.at}</span>;
  return <span>{JSON.stringify(s)}</span>;
}

export function CrewPanel() {
  const [states, setStates] = useState<CrewStates | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/config/crews");
      const data = (await res.json()) as CrewStates & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStates({ enabled: data.enabled ?? [], available: data.available ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(action: "enable" | "disable", id: string) {
    if (action === "disable" && !window.confirm(`确认停用 crew「${id}」？workspace 与数据保留，路由引用会被服务端拦截。`)) {
      return;
    }
    setBusy(id);
    setError("");
    setOkMsg("");
    try {
      const data = await apiPost("/api/config/crews/toggle", { action, id });
      setOkMsg(`${action === "enable" ? "启用" : "停用"}成功${data.note ? `：${data.note}` : ""}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={CARD_CLS}>
      <h2 className="mb-1 text-sm font-medium">Crew 启停</h2>
      <p className="mb-3 text-xs text-neutral-500">
        启用 = workspace sample 并入 agents.list；停用 = 移除 entry（workspace 与数据保留，配置引用会被服务端拦截）。
      </p>
      {error && <p className={ERR_CLS}>{error}</p>}
      {okMsg && <p className={OK_CLS}>{okMsg}</p>}
      {states && (
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1 text-xs text-neutral-500">已启用</p>
            <div className="flex flex-col gap-1">
              {states.enabled.map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{c.id}</span>
                  {c.name && c.name !== c.id && <span className="text-xs text-neutral-500">{c.name}</span>}
                  {c.protected && (
                    <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800">
                      受保护
                    </span>
                  )}
                  <button
                    onClick={() => toggle("disable", c.id)}
                    disabled={c.protected || busy !== ""}
                    className={`${BTN_CLS} ml-auto`}
                  >
                    {busy === c.id ? "处理中…" : "停用"}
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs text-neutral-500">可启用（workspace 已就位）</p>
            {states.available.length === 0 ? (
              <p className="text-xs text-neutral-400">无待启用的 crew sample</p>
            ) : (
              <div className="flex flex-col gap-1">
                {states.available.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{s.id}</span>
                    <span className="text-xs text-neutral-500">
                      {s.name} · {s.skills} 个技能
                    </span>
                    <button onClick={() => toggle("enable", s.id)} disabled={busy !== ""} className={`${BTN_CLS} ml-auto`}>
                      {busy === s.id ? "处理中…" : "启用"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function ProviderPanel() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/config/gateway");
        const data = (await res.json()) as { providers?: ProviderInfo[] };
        setProviders(data.providers ?? []);
      } catch {
        // Providers 无法获取时下拉为空，仍可手动输入 id
      }
    })();
  }, []);

  async function save() {
    setBusy(true);
    setError("");
    setOkMsg("");
    try {
      const data = await apiPost("/api/config/provider", { providerId, apiKey, baseUrl });
      setOkMsg(`provider 更新成功${data.note ? `：${data.note}` : ""}（apiKey 不回显）`);
      setApiKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={CARD_CLS}>
      <h2 className="mb-1 text-sm font-medium">Provider 凭证轮换</h2>
      <p className="mb-3 text-xs text-neutral-500">
        仅更新已存在 provider 的 apiKey / baseUrl（合并语义，未填字段保留原值）；不开放新建
        provider。apiKey 提交后不回显。
      </p>
      <div className="mb-2 max-w-md">
        <label className="mb-1 block text-xs text-neutral-500">Provider</label>
        <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className={INPUT_CLS}>
          <option value="">选择…</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id}
              {p.baseUrl ? `（${p.baseUrl}）` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-2 grid max-w-md grid-cols-1 gap-2">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className={INPUT_CLS}
          placeholder="新 apiKey（留空保持不变）"
          autoComplete="new-password"
        />
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className={INPUT_CLS}
          placeholder="新 baseUrl（留空保持不变）"
        />
      </div>
      <button onClick={save} disabled={!providerId || busy} className={BTN_CLS}>
        {busy ? "写回中…" : "更新 provider"}
      </button>
      {error && <p className={ERR_CLS}>{error}</p>}
      {okMsg && <p className={OK_CLS}>{okMsg}</p>}
    </section>
  );
}

export function CronPanel() {
  const [jobs, setJobs] = useState<CronJob[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cron");
      const data = (await res.json()) as { jobs?: CronJob[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setJobs(data.jobs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: "run" | "remove" | "toggle", job: CronJob) {
    if (action === "remove" && !window.confirm(`确认删除 cron 任务「${job.name}」？不可恢复。`)) return;
    setBusy(job.id + action);
    setError("");
    try {
      await apiPost("/api/cron/action", {
        action,
        id: job.id,
        ...(action === "toggle" ? { enabled: !job.enabled } : {}),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={CARD_CLS}>
      <h2 className="mb-1 text-sm font-medium">Cron 任务</h2>
      <p className="mb-3 text-xs text-neutral-500">
        gateway 原生 cron RPC：列表 / 立即运行 / 启停 / 删除。新建与改期不在 web 开放（agent
        会话内创建，web 只做运维操作）。
      </p>
      {error && <p className={ERR_CLS}>{error}</p>}
      {jobs && jobs.length === 0 && <p className="text-sm text-neutral-500">暂无 cron 任务。</p>}
      {jobs && jobs.length > 0 && (
        <div className="flex flex-col gap-2">
          {jobs.map((j) => (
            <div
              key={j.id}
              className="flex flex-wrap items-center gap-2 rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800"
            >
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  j.enabled
                    ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                    : "bg-neutral-200 text-neutral-500 dark:bg-neutral-800"
                }`}
              >
                {j.enabled ? "启用" : "停用"}
              </span>
              <span className="font-medium">{j.name}</span>
              {j.agentId && <span className="text-xs text-neutral-500">@{j.agentId}</span>}
              <span className="text-xs text-neutral-500">
                <ScheduleLabel job={j} />
              </span>
              {j.lastRunStatus && (
                <span className="text-xs text-neutral-400">上次: {j.lastRunStatus}</span>
              )}
              <div className="ml-auto flex gap-1">
                <button onClick={() => act("run", j)} disabled={busy !== ""} className={BTN_CLS}>
                  {busy === j.id + "run" ? "运行中…" : "立即运行"}
                </button>
                <button onClick={() => act("toggle", j)} disabled={busy !== ""} className={BTN_CLS}>
                  {busy === j.id + "toggle" ? "处理中…" : j.enabled ? "停用" : "启用"}
                </button>
                <button onClick={() => act("remove", j)} disabled={busy !== ""} className={BTN_CLS}>
                  {busy === j.id + "remove" ? "删除中…" : "删除"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
