import Link from "next/link";

import { getDnaIndex } from "@/lib/xiaobei-domain";

export const dynamic = "force-dynamic";

export default function DnaPage() {
  const dnas = getDnaIndex();

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-lg font-semibold">内容 DNA</h1>
      <p className="mb-4 text-xs text-neutral-500">
        各平台内容风格 DNA（&lt;platform&gt;/dna/，只读）。维度框架由 agent 维护，发布数据回填后带
        ⏳ 的维度逐步校准。
      </p>

      {dnas.length === 0 ? (
        <p className="text-sm text-neutral-500">各平台暂无 DNA（agent 建立风格档案后在此展示）。</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {dnas.map((d) => (
            <Link
              key={`${d.platform}/${d.id}`}
              href={`/dna/${d.platform}/${d.id}`}
              className="rounded-lg border border-neutral-200 p-4 transition-colors hover:border-blue-400 dark:border-neutral-800 dark:hover:border-blue-600"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{d.platformLabel}</span>
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                  {d.id}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-500">
                <span>{d.hasDoc ? "DNA 文档 ✓" : "DNA 文档缺失"}</span>
                <span>·</span>
                <span>{d.hasTemplate ? "模板 ✓" : "无模板"}</span>
                <span>·</span>
                <span>复盘 {d.reports.length}</span>
                <span>·</span>
                <span>评估 {d.evals.length}</span>
                {d.covers > 0 && (
                  <>
                    <span>·</span>
                    <span>封面 {d.covers}</span>
                  </>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
