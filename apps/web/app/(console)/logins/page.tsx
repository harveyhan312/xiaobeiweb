import { formatMs } from "@/lib/xiaobei-data";
import { getLoginStatuses, summarizeLoginStatuses, type LoginState } from "@/lib/xiaobei-logins";

import ReloginAction from "./ReloginAction";

export const dynamic = "force-dynamic";

const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  kuaishou: "快手",
  bilibili: "B 站",
  "xhs-browse": "小红书（浏览）",
  "xhs-publish": "小红书（创作）",
  wx_mp: "公众号",
};

const STATE_META: Record<LoginState, { label: string; cls: string; dot: string }> = {
  valid: {
    label: "有效",
    cls: "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950",
    dot: "bg-green-500",
  },
  expiring: {
    label: "临期",
    cls: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950",
    dot: "bg-amber-500",
  },
  expired: {
    label: "已过期",
    cls: "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950",
    dot: "bg-red-500",
  },
  "not-logged-in": {
    label: "未登录",
    cls: "border-orange-200 bg-orange-50/60 dark:border-orange-900 dark:bg-orange-950",
    dot: "bg-orange-400",
  },
  "no-data": {
    label: "无数据",
    cls: "border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900",
    dot: "bg-neutral-400",
  },
};

export default function LoginsPage() {
  const statuses = getLoginStatuses();
  const summary = summarizeLoginStatuses(statuses);
  const alertStates: LoginState[] = ["expired", "expiring", "not-logged-in"];
  const alerts = statuses.filter((s) => alertStates.includes(s.state));

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-lg font-semibold">登录态</h1>
      <p className="mb-4 text-xs text-neutral-500">
        平台登录 cookie 状态（~/.openclaw/logins/，只读元数据，不含 cookie 内容）。预警为本地过期时间判定，服务端提前失效需探活（v2）。
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {statuses.map((s) => {
          const meta = STATE_META[s.state];
          return (
            <div key={s.platform} className={`rounded-lg border p-4 ${meta.cls}`}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{PLATFORM_LABELS[s.platform] ?? s.platform}</div>
                <span className="flex items-center gap-1.5 text-xs">
                  <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden />
                  {meta.label}
                </span>
              </div>
              <div className="mt-2 space-y-1 text-xs text-neutral-600 dark:text-neutral-400">
                <div>最近更新：{s.updatedAt ? formatTime(s.updatedAt) : "—"}</div>
                <div>
                  最近过期：{s.maxExpiresAtMs ? formatMs(s.maxExpiresAtMs) : s.sessionOnly ? "会话 cookie（无法本地预警）" : "—"}
                </div>
                <div className="truncate" title={s.cookieNames.join(", ")}>
                  关键 cookie：{s.cookieNames.length > 0 ? s.cookieNames.join(", ") : "无"}
                </div>
              </div>
              {alertStates.includes(s.state) && <ReloginAction platform={s.platform} />}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-neutral-500">
        {alertStates.concat("valid", "no-data").map((st) => (
          <span key={st} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${STATE_META[st].dot}`} aria-hidden />
            {STATE_META[st].label} ×{summary[st]}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return formatMs(ms);
}
