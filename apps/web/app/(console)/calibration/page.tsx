import { Markdown } from "@/app/(console)/_components/markdown";
import { getCalibrations } from "@/lib/xiaobei-domain";

export const dynamic = "force-dynamic";

export default function CalibrationPage() {
  const calibrations = getCalibrations();

  const s = (v: unknown): string | null =>
    v === undefined || v === null || v === "" ? null : String(v);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-lg font-semibold">复盘校准</h1>
      <p className="mb-4 text-xs text-neutral-500">
        各平台 calibration/（只读）：platform-state.json 运行参数 + 受众/基准等校准文档。
      </p>

      {calibrations.length === 0 ? (
        <p className="text-sm text-neutral-500">各平台暂无校准数据（&lt;platform&gt;/calibration/ 尚未创建）。</p>
      ) : (
        <div className="flex flex-col gap-4">
          {calibrations.map((c) => (
            <section
              key={c.platform}
              className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">{c.platformLabel}</h2>
                {c.state && (
                  <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                    schema v{String(c.state.schema_version ?? "?")}
                  </span>
                )}
              </div>

              {c.state && (
                <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-neutral-500 sm:grid-cols-3">
                  {[
                    ["内容形态", s(c.state.content_form)],
                    ["典型字数", s(c.state.typical_word_count)],
                    ["基准播放", s(c.state.baseline_plays)],
                    [
                      "性能适配器",
                      s(
                        Array.isArray(c.state.enabled_perf_adapters)
                          ? (c.state.enabled_perf_adapters as unknown[]).join(", ")
                          : null,
                      ),
                    ],
                    ["创建时间", s(c.state.created_at)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="inline text-neutral-400">{k}：</dt>
                      <dd className="inline">{v ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {c.docs.map((d) => (
                <details key={d.name} className="mt-3">
                  <summary className="cursor-pointer text-sm text-neutral-600 dark:text-neutral-300">
                    {d.name}
                  </summary>
                  <div className="mt-2 rounded bg-neutral-50 p-3 dark:bg-neutral-900">
                    <Markdown text={d.content} />
                  </div>
                </details>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
