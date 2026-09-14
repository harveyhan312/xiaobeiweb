import { formatMs, getSessionsIndex } from "@/lib/xiaobei-data";

export const dynamic = "force-dynamic";

export default function SessionsPage() {
  const sessions = getSessionsIndex("main");

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-lg font-semibold">会话</h1>
      <p className="mb-4 text-xs text-neutral-500">
        main agent 的会话索引（agents/main/sessions/sessions.json），按最近更新排序。
      </p>
      {sessions.length === 0 ? (
        <p className="text-sm text-neutral-500">暂无会话。</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-800">
              <th className="py-2 pr-3">通道</th>
              <th className="py-2 pr-3">来源</th>
              <th className="py-2 pr-3">最近更新</th>
              <th className="py-2 pr-3">sessionKey</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr
                key={s.sessionKey}
                className="border-b border-neutral-100 dark:border-neutral-900"
              >
                <td className="py-2 pr-3">
                  <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                    {s.provider ?? "—"}
                  </span>
                </td>
                <td className="max-w-52 truncate py-2 pr-3" title={s.originLabel ?? ""}>
                  {s.originLabel ?? "—"}
                </td>
                <td className="py-2 pr-3 text-xs text-neutral-500">{formatMs(s.updatedAt)}</td>
                <td className="py-2 pr-3 font-mono text-xs text-neutral-400">{s.sessionKey}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
