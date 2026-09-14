"use client";

import { useState } from "react";

type Kind = "awada" | "feishu" | "";

type PreviewResult = {
  baseHash: string | null;
  patchMasked: Record<string, unknown>;
  replacePaths: string[];
  summary: string[];
  currentChannels: Record<string, unknown>;
};

type ApplyResult = {
  ok: boolean;
  restart?: unknown;
  sentinel?: unknown;
  note?: string;
};

type RestartResult = {
  preflight: unknown;
  result: unknown;
};

type AccountRow = { accountId: string; appId: string; appSecret: string };

const DEFAULT_ACCOUNTS: AccountRow[] = [
  { accountId: "main-bot", appId: "", appSecret: "" },
  { accountId: "producer-bot", appId: "", appSecret: "" },
  { accountId: "it-bot", appId: "", appSecret: "" },
];

const INPUT_CLS =
  "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900";
const BTN_CLS =
  "rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300";
const BTN_SECONDARY_CLS =
  "rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800";

function buildRequestBody(kind: Kind, awadaKey: string, accounts: AccountRow[]) {
  if (kind === "awada") return { kind, awadaKey };
  return {
    kind,
    accounts: accounts.filter((a) => a.appId.trim() !== "" || a.appSecret.trim() !== ""),
  };
}

export default function ChannelBindPanel() {
  const [kind, setKind] = useState<Kind>("");
  const [awadaKey, setAwadaKey] = useState("");
  const [accounts, setAccounts] = useState<AccountRow[]>(DEFAULT_ACCOUNTS);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [restartResult, setRestartResult] = useState<RestartResult | null>(null);
  const [pending, setPending] = useState<"preview" | "apply" | "restart" | null>(null);
  const [error, setError] = useState("");

  const resetStage = () => {
    setPreview(null);
    setApplyResult(null);
    setRestartResult(null);
    setError("");
  };

  const changeKind = (k: Kind) => {
    setKind(k);
    resetStage();
  };

  async function postJson(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      throw new Error(String(data?.error ?? `HTTP ${res.status}`));
    }
    return data;
  }

  async function doPreview() {
    if (!kind) return;
    setPending("preview");
    resetStage();
    try {
      const data = (await postJson("/api/config/channel/preview", buildRequestBody(kind, awadaKey, accounts))) as unknown as PreviewResult;
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  async function doApply() {
    if (!kind) return;
    setPending("apply");
    setError("");
    try {
      const data = (await postJson("/api/config/channel/apply", buildRequestBody(kind, awadaKey, accounts))) as unknown as ApplyResult;
      setApplyResult(data);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  async function doRestart() {
    setPending("restart");
    setError("");
    try {
      const data = (await postJson("/api/config/gateway/restart", {})) as unknown as RestartResult;
      setRestartResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  const updateAccount = (idx: number, field: keyof AccountRow, value: string) => {
    setAccounts((prev) => prev.map((a, i) => (i === idx ? { ...a, [field]: value } : a)));
  };

  return (
    <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="mb-1 text-sm font-medium">Channel 绑定（写回）</h2>
      <p className="mb-3 text-xs text-neutral-500">
        走 gateway config.patch RPC：服务端模板生成 patch（浏览器不上送配置片段）、预览打码回显、apply 带
        baseHash 乐观并发 + replacePaths 守护；写盘由 gateway 自动 .bak 轮转。部分变更需重启 gateway 生效。
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-sm text-neutral-500">类型</label>
        <select
          value={kind}
          onChange={(e) => changeKind(e.target.value as Kind)}
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">选择…</option>
          <option value="awada">awada</option>
          <option value="feishu">feishu</option>
        </select>
        <button onClick={doPreview} disabled={!kind || pending !== null} className={BTN_SECONDARY_CLS}>
          {pending === "preview" ? "预览中…" : "预览 patch（打码）"}
        </button>
        <button onClick={doRestart} disabled={pending !== null} className={BTN_SECONDARY_CLS}>
          {pending === "restart" ? "重启中…" : "手动重启 gateway"}
        </button>
      </div>

      {kind === "awada" && (
        <div className="mb-3 max-w-md">
          <label className="mb-1 block text-xs text-neutral-500">awadaKey</label>
          <input
            type="password"
            value={awadaKey}
            onChange={(e) => setAwadaKey(e.target.value)}
            className={INPUT_CLS}
            placeholder="AWADA_KEY"
          />
        </div>
      )}

      {kind === "feishu" && (
        <div className="mb-3 flex flex-col gap-2">
          {accounts.map((a, i) => (
            <div key={a.accountId} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="flex items-center text-sm font-medium">{a.accountId}</div>
              <input
                type="text"
                value={a.appId}
                onChange={(e) => updateAccount(i, "appId", e.target.value)}
                className={INPUT_CLS}
                placeholder="appId"
                autoComplete="off"
              />
              <input
                type="password"
                value={a.appSecret}
                onChange={(e) => updateAccount(i, "appSecret", e.target.value)}
                className={INPUT_CLS}
                placeholder="appSecret"
                autoComplete="new-password"
              />
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {preview && (
        <div className="mb-3 rounded border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950">
          <p className="mb-2 text-xs font-medium text-blue-700 dark:text-blue-300">
            dry-run 回显（密钥已打码）— replacePaths: {preview.replacePaths.join("、") || "无"} · baseHash:{" "}
            {preview.baseHash ? `${preview.baseHash.slice(0, 12)}…` : "无"}
          </p>
          <ul className="mb-2 list-disc pl-5 text-xs text-blue-800 dark:text-blue-200">
            {preview.summary.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <pre className="mb-3 max-h-56 overflow-auto rounded bg-white/70 p-2 text-xs dark:bg-neutral-900">
            {JSON.stringify(preview.patchMasked, null, 2)}
          </pre>
          <button onClick={doApply} disabled={pending !== null} className={BTN_CLS}>
            {pending === "apply" ? "写回中…" : "确认并写回 openclaw.json"}
          </button>
        </div>
      )}

      {applyResult && (
        <div className="mb-3 rounded border border-green-200 bg-green-50 p-3 text-sm dark:border-green-900 dark:bg-green-950">
          <p className="mb-2 font-medium text-green-800 dark:text-green-200">
            写回成功。旧配置由 gateway 轮转为 .bak；restart 计划如下，需重启才生效的部分可点「手动重启
            gateway」。
          </p>
          {applyResult.note && (
            <p className="mb-2 text-xs text-green-700 dark:text-green-300">{applyResult.note}</p>
          )}
          <pre className="max-h-56 overflow-auto rounded bg-white/70 p-2 text-xs dark:bg-neutral-900">
            {JSON.stringify({ restart: applyResult.restart, sentinel: applyResult.sentinel }, null, 2)}
          </pre>
        </div>
      )}

      {restartResult && (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          <p className="mb-2 text-xs text-neutral-500">preflight + restart 响应：</p>
          <pre className="max-h-56 overflow-auto rounded bg-white/70 p-2 text-xs dark:bg-neutral-950">
            {JSON.stringify(restartResult, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
