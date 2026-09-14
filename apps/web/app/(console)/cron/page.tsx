import { formatMs, getCronJobs } from "@/lib/xiaobei-data";

export const dynamic = "force-dynamic";

export default function CronPage() {
  const jobs = getCronJobs();

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-lg font-semibold">定时任务</h1>
      <p className="mb-4 text-xs text-neutral-500">
        引擎 cron_jobs 表（只读）。增删改走 agent 对话或 MCP 工具，本页不提供写操作。
      </p>
      {jobs.length === 0 ? (
        <p className="text-sm text-neutral-500">暂无定时任务。</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-800">
              <th className="py-2 pr-3">名称</th>
              <th className="py-2 pr-3">Agent</th>
              <th className="py-2 pr-3">调度</th>
              <th className="py-2 pr-3">状态</th>
              <th className="py-2 pr-3">下次运行</th>
              <th className="py-2 pr-3">上次结果</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.jobId} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-2 pr-3">{j.name}</td>
                <td className="py-2 pr-3 text-xs">{j.agentId ?? "—"}</td>
                <td className="py-2 pr-3 text-xs">
                  {j.scheduleKind === "cron"
                    ? j.scheduleExpr
                    : j.scheduleKind === "every"
                      ? `每 ${Math.round((j.scheduleExpr ? Number(j.scheduleExpr) : 0) / 60000)} 分钟`
                      : (j.scheduleExpr ?? j.scheduleKind ?? "—")}
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      j.enabled
                        ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                        : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800"
                    }`}
                  >
                    {j.enabled ? "启用" : "停用"}
                  </span>
                </td>
                <td className="py-2 pr-3 text-xs text-neutral-500">{formatMs(j.nextRunAtMs)}</td>
                <td className="py-2 pr-3 text-xs">
                  {j.lastError ? (
                    <span className="text-red-600 dark:text-red-400">{j.lastError}</span>
                  ) : (
                    (j.lastRunStatus ?? "—")
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
