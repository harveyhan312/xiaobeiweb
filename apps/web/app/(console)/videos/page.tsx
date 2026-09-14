import { getVideoProjects, VIDEO_MILESTONE_LABELS } from "@/lib/xiaobei-domain";

export const dynamic = "force-dynamic";

export default function VideosPage() {
  const projects = getVideoProjects();

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-lg font-semibold">视频生产任务</h1>
      <p className="mb-4 text-xs text-neutral-500">
        扫 content-producer/output_videos/ 与各平台 outputs/（只读）。按产物文件存在性推断各阶段
        checkpoint（产物存在即完成，由 agent 的 video-producer 流程维护）。
      </p>

      {projects.length === 0 ? (
        <p className="text-sm text-neutral-500">
          暂无视频生产任务——content-producer 产出视频工程目录后（brief.md 起步），本页展示{" "}
          {VIDEO_MILESTONE_LABELS.length} 阶段进度。
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {projects.map((p) => (
            <div
              key={`${p.source}/${p.name}`}
              className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.name}</span>
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800">
                  {p.source}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {VIDEO_MILESTONE_LABELS.map(([key, label]) => (
                  <span
                    key={key}
                    className={`rounded px-2 py-0.5 text-xs ${
                      p.milestones[key]
                        ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                        : "bg-neutral-100 text-neutral-400 line-through dark:bg-neutral-900"
                    }`}
                  >
                    {p.milestones[key] ? "✓ " : ""}
                    {label}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-neutral-400">{p.dir}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
