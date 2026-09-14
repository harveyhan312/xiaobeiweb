import { notFound } from "next/navigation";

import { Markdown } from "@/app/(console)/_components/markdown";
import { getDnaIndex, readWorkspaceTextFile } from "@/lib/xiaobei-domain";

export const dynamic = "force-dynamic";

const SEG_SHAPE = /^[A-Za-z0-9_-]+$/;

export default async function DnaDetailPage({
  params,
}: {
  params: Promise<{ platform: string; dnaId: string }>;
}) {
  const { platform, dnaId } = await params;
  if (!SEG_SHAPE.test(platform) || !SEG_SHAPE.test(dnaId)) notFound();

  const dna = getDnaIndex().find((d) => d.platform === platform && d.id === dnaId);
  if (!dna) notFound();

  const base = `${platform}/dna/${dnaId}`;
  const doc = dna.hasDoc ? readWorkspaceTextFile(base, `${dnaId}.dna.md`) : null;
  const template = dna.hasTemplate ? readWorkspaceTextFile(base, `${dnaId}.template.md`) : null;
  const reports = dna.reports
    .map((name) => ({ name, content: readWorkspaceTextFile(base, "reports", name) }))
    .filter((r): r is { name: string; content: string } => r.content !== null);
  const evals = dna.evals
    .map((name) => ({ name, content: readWorkspaceTextFile(base, "evals", name) }))
    .filter((r): r is { name: string; content: string } => r.content !== null);

  return (
    <div className="mx-auto max-w-4xl">
      <p className="mb-1 text-xs text-neutral-400">
        {dna.platformLabel} / {dna.id}
      </p>
      <h1 className="mb-4 text-lg font-semibold">内容风格 DNA</h1>

      {doc ? (
        <article className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <Markdown text={doc} />
        </article>
      ) : (
        <p className="text-sm text-neutral-500">DNA 文档缺失。</p>
      )}

      {template && (
        <details className="mt-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <summary className="cursor-pointer text-sm font-medium">模板（template.md）</summary>
          <div className="mt-2">
            <Markdown text={template} />
          </div>
        </details>
      )}

      {reports.length > 0 && (
        <section className="mt-4">
          <h2 className="mb-2 text-sm font-medium text-neutral-500">复盘报告</h2>
          {reports.map((r) => (
            <details
              key={r.name}
              className="mb-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <summary className="cursor-pointer text-sm">{r.name}</summary>
              <div className="mt-2">
                <Markdown text={r.content} />
              </div>
            </details>
          ))}
        </section>
      )}

      {evals.length > 0 && (
        <section className="mt-4">
          <h2 className="mb-2 text-sm font-medium text-neutral-500">内容评估</h2>
          {evals.map((r) => (
            <details
              key={r.name}
              className="mb-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <summary className="cursor-pointer text-sm">{r.name}</summary>
              <div className="mt-2">
                <Markdown text={r.content} />
              </div>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
