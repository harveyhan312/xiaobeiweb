import { formatMs, getFlowRuns, getTaskRuns } from "@/lib/xiaobei-data";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  succeeded: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  running: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  cancelled: "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? "bg-neutral-100 text-neutral-600 dark:bg-neutral-800";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${style}`}>{status}</span>;
}

export default function TasksPage() {
  const tasks = getTaskRuns(50);
  const flows = getFlowRuns(20);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-4 text-lg font-semibold">任务队列</h1>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Flow runs（多步协作流）</h2>
        {flows.length === 0 ? (
          <p className="text-sm text-neutral-500">暂无 flow run。</p>
        ) : (
          <div className="flex flex-col gap-2">
            {flows.map((f) => (
              <div
                key={f.flowId}
                className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <div className="flex items-center gap-2">
                  <StatusBadge status={f.status} />
                  <span className="text-xs text-neutral-400">
                    更新于 {formatMs(f.updatedAt)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm">{f.goal}</p>
                {f.currentStep && (
                  <p className="mt-1 text-xs text-neutral-500">当前步骤：{f.currentStep}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Task runs（单任务）</h2>
        {tasks.length === 0 ? (
          <p className="text-sm text-neutral-500">暂无 task run。</p>
        ) : (
          <div className="flex flex-col gap-2">
            {tasks.map((t) => (
              <div
                key={t.taskId}
                className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={t.status} />
                  {t.agentId && (
                    <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                      {t.agentId}
                    </span>
                  )}
                  <span className="text-xs text-neutral-400">
                    {formatMs(t.startedAt)} → {formatMs(t.endedAt)}
                  </span>
                </div>
                {(t.progressSummary || t.terminalSummary || t.error) && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-neutral-500">
                      执行摘要
                    </summary>
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs dark:bg-neutral-900">
                      {t.error || t.terminalSummary || t.progressSummary}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
