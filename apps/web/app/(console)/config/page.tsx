import { getConfigSummary } from "@/lib/xiaobei-data";

export const dynamic = "force-dynamic";

export default function ConfigPage() {
  const cfg = getConfigSummary();

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-lg font-semibold">配置总览</h1>
      <p className="mb-4 text-xs text-neutral-500">
        ~/.openclaw/openclaw.json 摘要（只读，密钥字段已剔除）。修改配置必须走 IT engineer
        apply 脚本，本页不提供写操作。
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-2 text-sm font-medium">Agents</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {cfg.agents.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <span className="font-medium">{a.id}</span>
                {a.name && a.name !== a.id && (
                  <span className="text-xs text-neutral-500">{a.name}</span>
                )}
                {a.model && (
                  <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                    {a.model}
                  </span>
                )}
              </li>
            ))}
            {cfg.agents.length === 0 && <li className="text-neutral-500">未配置</li>}
          </ul>
          {cfg.defaultModel && (
            <p className="mt-2 text-xs text-neutral-500">默认模型：{cfg.defaultModel}</p>
          )}
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-2 text-sm font-medium">Channels</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {cfg.channels.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span className="font-medium">{c.id}</span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    c.enabled
                      ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                      : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800"
                  }`}
                >
                  {c.enabled ? "启用" : "停用"}
                </span>
              </li>
            ))}
            {cfg.channels.length === 0 && <li className="text-neutral-500">未配置</li>}
          </ul>
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-2 text-sm font-medium">模型 Providers</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {cfg.providers.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.id}</span>
                {p.api && (
                  <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                    {p.api}
                  </span>
                )}
                <span className="text-xs text-neutral-400">{p.baseUrl ?? ""}</span>
              </li>
            ))}
            {cfg.providers.length === 0 && <li className="text-neutral-500">未配置</li>}
          </ul>
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-2 text-sm font-medium">Gateway</h2>
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-neutral-500">bind</dt>
            <dd>{cfg.gateway.bind ?? "—"}</dd>
            <dt className="text-neutral-500">port</dt>
            <dd>{cfg.gateway.port ?? "—"}</dd>
            <dt className="text-neutral-500">auth.mode</dt>
            <dd>{cfg.gateway.authMode ?? "—"}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
