import { getMediaSummary } from "@/lib/xiaobei-data";

export const dynamic = "force-dynamic";

export default function MediaPage() {
  const dirs = getMediaSummary();
  const total = dirs.reduce((sum, d) => sum + (d.exists ? d.fileCount : 0), 0);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-lg font-semibold">媒体库</h1>
      <p className="mb-4 text-xs text-neutral-500">
        引擎收发媒体目录（~/.openclaw/media/）。共 {total} 个文件。目录会在首次收发媒体时自动创建。
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {dirs.map((d) => (
          <div
            key={d.name}
            className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
          >
            <div className="text-sm font-medium">{d.name}</div>
            <div className="mt-1 text-2xl font-semibold">{d.exists ? d.fileCount : "—"}</div>
            <div className="mt-1 font-mono text-xs text-neutral-400">{d.path}</div>
            {!d.exists && <div className="mt-1 text-xs text-neutral-500">目录尚未创建</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
