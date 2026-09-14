import { distributeLabel, getPublishedRows } from "@/lib/xiaobei-domain";

export const dynamic = "force-dynamic";

const DIST_STYLE: Record<number, string> = {
  0: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  1: "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  2: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
};

export default function PublishPage() {
  const rows = getPublishedRows(200);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-1 text-lg font-semibold">发布记录</h1>
      <p className="mb-4 text-xs text-neutral-500">
        引擎 published_track.db（只读，按平台 pub_* 表）。分发状态由 agent 经 published-track
        维护，本页不提供写操作。
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">
          暂无发布记录——published_track.db 尚未创建（agent
          首次发布内容后自动建库，届时本页显示标题/指标/DNA 归属）。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-800">
                <th className="py-2 pr-3 font-medium">平台</th>
                <th className="py-2 pr-3 font-medium">标题</th>
                <th className="py-2 pr-3 font-medium">类型</th>
                <th className="py-2 pr-3 font-medium">发布日期</th>
                <th className="py-2 pr-3 font-medium">分发</th>
                <th className="py-2 pr-3 font-medium">互动指标</th>
                <th className="py-2 pr-3 font-medium">DNA</th>
                <th className="py-2 pr-3 font-medium">账号</th>
                <th className="py-2 font-medium">链接</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.platform}-${r.publishDate}-${i}`}
                  className="border-b border-neutral-100 align-top dark:border-neutral-900"
                >
                  <td className="py-2 pr-3 whitespace-nowrap">{r.platformLabel}</td>
                  <td className="max-w-xs py-2 pr-3">
                    <span className="line-clamp-2">{r.title}</span>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-neutral-500">
                    {r.contentType ?? "—"}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-neutral-500">
                    {r.publishDate || "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${DIST_STYLE[r.distributeStatus] ?? "bg-neutral-100 text-neutral-600 dark:bg-neutral-800"}`}
                    >
                      {distributeLabel(r.distributeStatus)}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-xs text-neutral-500">
                    {Object.keys(r.metrics).length === 0
                      ? "—"
                      : Object.entries(r.metrics)
                          .map(([k, v]) => `${k} ${v}`)
                          .join(" · ")}
                  </td>
                  <td className="py-2 pr-3 text-xs text-neutral-500">{r.dnaId ?? "—"}</td>
                  <td className="py-2 pr-3 text-xs text-neutral-500">{r.account ?? "—"}</td>
                  <td className="py-2 text-xs">
                    {r.publishUrl ? (
                      <a
                        href={r.publishUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        打开
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
