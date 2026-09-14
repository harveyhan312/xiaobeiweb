"use client";

// 域数据写操作客户端组件：P3-C 低风险写回的 UI 入口。
// 全部经 postDomainJson（带令牌）→ 成功后 router.refresh() 重新拉取服务端数据。

import { useRouter } from "next/navigation";
import { useState } from "react";

import { postDomainJson } from "@/lib/client/api";

const CONTROL_CLS =
  "rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900";
const BTN_CLS =
  "rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800";
const ERR_CLS = "mt-1 text-xs text-red-600 dark:text-red-400";

// 写操作公共行为：pending/error 状态 + 成功后刷新服务端组件数据
function useWriteAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> => {
    setPending(true);
    setError(null);
    const r = await fn();
    setPending(false);
    if (!r.ok) {
      setError(r.error ?? "写入失败");
      return false;
    }
    router.refresh();
    return true;
  };
  return { pending, error, run, setError };
}

function ErrorText({ error }: { error: string | null }) {
  return error ? <p className={ERR_CLS}>{error}</p> : null;
}

// ── 发布记录：分发状态（0 待分发 / 1 无需分发 / 2 已分发）──
export function DistributeControl({
  platform,
  id,
  status,
}: {
  platform: string;
  id: number;
  status: number;
}) {
  const { pending, error, run } = useWriteAction();
  const set = (v: string) =>
    run(() =>
      postDomainJson("/api/domain/publish/distribute-status", {
        platform,
        id,
        status: v,
      }),
    );
  return (
    <div>
      <select
        value={String(status)}
        disabled={pending}
        onChange={(e) => void set(e.target.value)}
        className={CONTROL_CLS}
      >
        <option value="0">待分发</option>
        <option value="1">无需分发</option>
        <option value="2">已分发</option>
      </select>
      <ErrorText error={error} />
    </div>
  );
}

// ── 发布记录：互动指标补录（仅数值列，列名来自 PRAGMA 枚举）──
export function MetricsForm({
  platform,
  id,
  columns,
  current,
}: {
  platform: string;
  id: number;
  columns: string[];
  current: Record<string, number>;
}) {
  const { pending, error, run } = useWriteAction();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(columns.map((c) => [c, current[c] !== undefined ? String(current[c]) : ""])),
  );
  if (columns.length === 0) return <span className="text-xs text-neutral-400">无指标列</span>;
  const save = async () => {
    const metrics: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v.trim() !== "") metrics[k] = v.trim();
    }
    if (Object.keys(metrics).length === 0) return;
    const ok = await run(() =>
      postDomainJson("/api/domain/publish/metrics", { platform, id, metrics }),
    );
    if (ok) setOpen(false);
  };
  return (
    <div>
      <button type="button" className={BTN_CLS} onClick={() => setOpen((v) => !v)}>
        补录
      </button>
      {open && (
        <div className="mt-2 flex w-44 flex-col gap-1.5 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
          {columns.map((c) => (
            <label key={c} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-neutral-500">{c}</span>
              <input
                type="number"
                min={0}
                value={values[c] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [c]: e.target.value }))}
                className={`${CONTROL_CLS} w-20`}
              />
            </label>
          ))}
          <button
            type="button"
            className={`${BTN_CLS} bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:text-white`}
            disabled={pending}
            onClick={() => void save()}
          >
            {pending ? "保存中…" : "保存"}
          </button>
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}

// ── IR 投资人：状态推进 + 可选备注 ──
export function IrStatusControl({
  id,
  status,
  statuses,
}: {
  id: number;
  status: string;
  statuses: readonly string[];
}) {
  const { pending, error, run } = useWriteAction();
  const [notes, setNotes] = useState("");
  const post = () =>
    run(() => {
      const body: Record<string, unknown> = { id, status };
      if (notes.trim()) body.notes = notes.trim();
      return postDomainJson("/api/domain/ir/status", body);
    });
  return (
    <div className="flex flex-col gap-1">
      <select
        value={status}
        disabled={pending}
        onChange={(e) => void run(() => postDomainJson("/api/domain/ir/status", { id, status: e.target.value }))}
        className={CONTROL_CLS}
      >
        {statuses.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <details>
        <summary className="cursor-pointer text-xs text-neutral-500">备注</summary>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="可选，随状态一并保存"
          className={`${CONTROL_CLS} mt-1 w-40`}
        />
        <button type="button" className={`${BTN_CLS} mt-1`} disabled={pending} onClick={() => void post()}>
          {pending ? "保存中…" : "保存状态+备注"}
        </button>
      </details>
      <ErrorText error={error} />
    </div>
  );
}

// ── 客户跟进：标记完成（需回执文本）/ 取消待发 ──
export function FollowUpActions({ id, peer }: { id: number; peer: string }) {
  const { pending, error, run } = useWriteAction();
  const [sentText, setSentText] = useState("");
  const complete = () =>
    run(() =>
      postDomainJson("/api/domain/customers/followup", {
        action: "complete",
        id,
        sentText: sentText.trim() || "web 控制台标记完成",
      }),
    );
  const cancel = () => {
    if (!window.confirm(`确认把 ${peer} 的所有 pending 跟进任务标记为完成？`)) return;
    return run(() => postDomainJson("/api/domain/customers/followup", { action: "cancel", peer }));
  };
  return (
    <div className="mt-2">
      <details>
        <summary className="cursor-pointer text-xs text-blue-600 dark:text-blue-400">标记完成…</summary>
        <textarea
          rows={2}
          value={sentText}
          onChange={(e) => setSentText(e.target.value)}
          placeholder="回执/发送内容（留空则记为「web 控制台标记完成」）"
          className={`${CONTROL_CLS} mt-1 w-72`}
        />
        <button
          type="button"
          className={`${BTN_CLS} mt-1 bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:text-white`}
          disabled={pending}
          onClick={() => void complete()}
        >
          {pending ? "处理中…" : "确认完成"}
        </button>
      </details>
      <button
        type="button"
        className={`${BTN_CLS} mt-1 text-neutral-500`}
        disabled={pending}
        onClick={() => void cancel()}
      >
        取消该客户全部 pending
      </button>
      <ErrorText error={error} />
    </div>
  );
}
