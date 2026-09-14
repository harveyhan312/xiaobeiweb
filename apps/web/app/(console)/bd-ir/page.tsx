import { getBdData, getIrData, getIntelItems, PLATFORM_LABELS } from "@/lib/xiaobei-domain";

export const dynamic = "force-dynamic";

const IR_STATUS_STYLE: Record<string, string> = {
  new: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  contacted: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  bp_sent: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  meeting: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  dd: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  ts: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  invested: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  passed: "bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
};

function Badge({ status, style }: { status: string; style?: Record<string, string> }) {
  const cls =
    style?.[status] ?? "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

function platformLabel(p: string): string {
  return PLATFORM_LABELS[p] ?? p;
}

export default function BdIrPage() {
  const bd = getBdData();
  const intel = getIntelItems();
  const ir = getIrData();

  const soonMs = 7 * 24 * 3600 * 1000;
  const now = Date.now();
  const isSoon = (deadline: string | null) => {
    if (!deadline) return false;
    const t = Date.parse(deadline);
    return Number.isFinite(t) && t - now > 0 && t - now < soonMs;
  };

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-lg font-semibold">BD · IR</h1>
      <p className="mb-4 text-xs text-neutral-500">
        workspace-main/db/ 下 bd_record.db / info_record.db / ir_record.db（只读）。记录由 agent
        经 expert-bd / expert-ir 维护，本页不提供写操作。
      </p>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-neutral-500">
          BD 线索（lead_creators）{bd.leads.length > 0 && `· ${bd.leads.length}`}
        </h2>
        {bd.leads.length === 0 ? (
          <p className="text-sm text-neutral-500">暂无线索（bd_record.db 尚未创建或无记录）。</p>
        ) : (
          <div className="flex flex-col gap-2">
            {bd.leads.map((l) => (
              <div
                key={l.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
              >
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                  {platformLabel(l.platform)}
                </span>
                <span className="font-medium">{l.nickname ?? l.creatorId}</span>
                {l.qualified && (
                  <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-950 dark:text-green-300">
                    qualified
                  </span>
                )}
                {l.notes && <span className="text-xs text-neutral-500">{l.notes}</span>}
                {l.homepageUrl && (
                  <a
                    href={l.homepageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    主页
                  </a>
                )}
                <span className="text-xs text-neutral-400">{l.createdAt}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-neutral-500">
          评论互动（comment_posts）{bd.comments.length > 0 && `· ${bd.comments.length}`}
        </h2>
        {bd.comments.length === 0 ? (
          <p className="text-sm text-neutral-500">暂无评论互动记录。</p>
        ) : (
          <div className="flex flex-col gap-2">
            {bd.comments.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                    {platformLabel(c.platform)}
                  </span>
                  <Badge
                    status={c.replied ? "已回复" : "待回复"}
                    style={
                      c.replied
                        ? { 已回复: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" }
                        : undefined
                    }
                  />
                  <span className="text-xs text-neutral-500">{c.strategy}</span>
                  <span className="ml-auto text-xs text-neutral-400">{c.createdAt}</span>
                </div>
                {c.postTitle && <p className="mt-1 line-clamp-1 text-xs text-neutral-500">{c.postTitle}</p>}
                {c.replyContent && (
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-neutral-500">
                    回复：{c.replyContent}
                  </p>
                )}
                {c.postUrl && (
                  <a
                    href={c.postUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    原帖
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-neutral-500">
          BD 情报（intel_items）{intel.length > 0 && `· ${intel.length}`}
        </h2>
        {intel.length === 0 ? (
          <p className="text-sm text-neutral-500">暂无情报记录（info_record.db 尚未创建或无记录）。</p>
        ) : (
          <div className="flex flex-col gap-2">
            {intel.map((it) => (
              <div
                key={it.id}
                className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                    {it.source}
                  </span>
                  <span className="text-xs text-neutral-500">{it.sourceType}</span>
                  {it.author && <span className="text-xs text-neutral-500">{it.author}</span>}
                  <span className="ml-auto text-xs text-neutral-400">{it.createdAt}</span>
                </div>
                {it.title && <p className="mt-1 line-clamp-1">{it.title}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-neutral-500">
          IR 投资人（investors）{ir.investors.length > 0 && `· ${ir.investors.length}`}
        </h2>
        {ir.investors.length === 0 ? (
          <p className="text-sm text-neutral-500">暂无投资人记录（ir_record.db 尚未创建或无记录）。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-800">
                  <th className="py-2 pr-3 font-medium">姓名</th>
                  <th className="py-2 pr-3 font-medium">类型</th>
                  <th className="py-2 pr-3 font-medium">机构</th>
                  <th className="py-2 pr-3 font-medium">状态</th>
                  <th className="py-2 pr-3 font-medium">关注方向</th>
                  <th className="py-2 pr-3 font-medium">匹配度</th>
                  <th className="py-2 font-medium">更新时间</th>
                </tr>
              </thead>
              <tbody>
                {ir.investors.map((v) => (
                  <tr key={v.id} className="border-b border-neutral-100 dark:border-neutral-900">
                    <td className="py-2 pr-3 font-medium">{v.name}</td>
                    <td className="py-2 pr-3 text-neutral-500">{v.type}</td>
                    <td className="py-2 pr-3">{v.firm}</td>
                    <td className="py-2 pr-3">
                      <Badge status={v.status} style={IR_STATUS_STYLE} />
                    </td>
                    <td className="max-w-xs py-2 pr-3 text-xs text-neutral-500">
                      <span className="line-clamp-2">{v.focusAreas ?? "—"}</span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-neutral-500">{v.matchScore ?? "—"}</td>
                    <td className="py-2 text-xs text-neutral-400">{v.updatedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-neutral-500">
          IR 申报（applications）{ir.applications.length > 0 && `· ${ir.applications.length}`}
        </h2>
        {ir.applications.length === 0 ? (
          <p className="text-sm text-neutral-500">暂无申报记录。</p>
        ) : (
          <div className="flex flex-col gap-2">
            {ir.applications.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
              >
                <span className="font-medium">{a.name}</span>
                <span className="text-xs text-neutral-500">{a.type}</span>
                {a.organizer && <span className="text-xs text-neutral-500">{a.organizer}</span>}
                {a.deadline &&
                  (isSoon(a.deadline) ? (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                      DDL {a.deadline}（7 天内）
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-500">DDL {a.deadline}</span>
                  ))}
                <Badge status={a.status} />
                {a.result && <span className="text-xs text-neutral-500">结果：{a.result}</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
