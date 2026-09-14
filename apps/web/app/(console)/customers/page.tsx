import { getCustomerData } from "@/lib/xiaobei-domain";

export const dynamic = "force-dynamic";

const CS_STATUS_STYLE: Record<string, string> = {
  free: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  exp_invited: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  club: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  subs: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
};

const FU_STATUS_STYLE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  sent_once: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  completed: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
};

export default function CustomersPage() {
  const { records, followUps } = getCustomerData();

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-lg font-semibold">客户库</h1>
      <p className="mb-4 text-xs text-neutral-500">
        workspace-sales-cs/db/customer.db（只读）。cs_record 的 business_status 由系统 hook
        在支付/入群事件写入，web 不改；跟进任务由 sales-cs crew 维护。
      </p>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-neutral-500">
          客户档案（cs_record）{records.length > 0 && `· ${records.length}`}
        </h2>
        {records.length === 0 ? (
          <p className="text-sm text-neutral-500">
            暂无客户记录——sales-cs crew 启用并产生客户互动后，customer.db 由系统 hook 自动建库写入。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-800">
                  <th className="py-2 pr-3 font-medium">客户（peer）</th>
                  <th className="py-2 pr-3 font-medium">业务状态</th>
                  <th className="py-2 pr-3 font-medium">目的</th>
                  <th className="py-2 font-medium">更新时间</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.peer} className="border-b border-neutral-100 dark:border-neutral-900">
                    <td className="py-2 pr-3 font-medium">{r.peer}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${CS_STATUS_STYLE[r.businessStatus] ?? "bg-neutral-100 text-neutral-600 dark:bg-neutral-800"}`}
                      >
                        {r.businessStatus}
                      </span>
                    </td>
                    <td className="max-w-xs py-2 pr-3 text-xs text-neutral-500">
                      <span className="line-clamp-1">{r.purpose || "—"}</span>
                    </td>
                    <td className="py-2 text-xs text-neutral-400">{r.updatedAt ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-neutral-500">
          跟进任务（follow_up，未完成）{followUps.length > 0 && `· ${followUps.length}`}
        </h2>
        {followUps.length === 0 ? (
          <p className="text-sm text-neutral-500">暂无待跟进任务。</p>
        ) : (
          <div className="flex flex-col gap-2">
            {followUps.map((f) => (
              <div
                key={f.id}
                className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{f.peer}</span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${FU_STATUS_STYLE[f.status] ?? "bg-neutral-100 text-neutral-600 dark:bg-neutral-800"}`}
                  >
                    {f.status}
                  </span>
                  <span className="ml-auto text-xs text-neutral-400">计划 {f.followUpAt}</span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">原因：{f.reason}</p>
                {f.contextSummary && (
                  <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{f.contextSummary}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
