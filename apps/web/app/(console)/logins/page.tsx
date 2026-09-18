import { getLoginStatuses, summarizeLoginStatuses } from "@/lib/xiaobei-logins";

import { ALERT_STATES, PLATFORM_LABELS, STATE_META } from "./login-meta";
import LoginsBoard from "./logins-board";

export const dynamic = "force-dynamic";

export default function LoginsPage() {
  const statuses = getLoginStatuses();
  const summary = summarizeLoginStatuses(statuses);
  const alerts = statuses.filter((s) => ALERT_STATES.includes(s.state));

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-lg font-semibold">登录态</h1>
      <p className="mb-4 text-xs text-neutral-500">
        平台登录 cookie 状态（~/.openclaw/logins/，只读元数据，不含 cookie 内容）。
        预警为本地过期时间判定；本地未过期 ≠ 服务端有效，探活平台（抖音/B 站/快手/小红书浏览）进入页面自动探测，也可手动重探。
      </p>

      {alerts.length > 0 ? (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950">
          <span className="font-medium">⚠ 预警：</span>
          {alerts
            .map((s) => `${PLATFORM_LABELS[s.platform] ?? s.platform}（${STATE_META[s.state].label}）`)
            .join("、")}
          。登录失效会断开对应平台的发布/抓取链路，请让小贝重新登录。
        </div>
      ) : (
        <div className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm dark:border-green-900 dark:bg-green-950">
          全部平台登录态正常或无数据，无预警。
        </div>
      )}

      <LoginsBoard statuses={statuses} />

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-neutral-500">
        {ALERT_STATES.concat("valid", "no-data").map((st) => (
          <span key={st} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${STATE_META[st].dot}`} aria-hidden />
            {STATE_META[st].label} ×{summary[st]}
          </span>
        ))}
      </div>
    </div>
  );
}
