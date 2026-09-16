import Link from "next/link";
import type { ReactNode } from "react";

const NAV_GROUPS: Array<{
  title: string;
  items: Array<{ href: string; label: string }>;
}> = [
  {
    title: "业务",
    items: [
      { href: "/publish", label: "发布记录" },
      { href: "/dna", label: "内容 DNA" },
      { href: "/calibration", label: "复盘校准" },
      { href: "/bd-ir", label: "BD·IR" },
      { href: "/customers", label: "客户库" },
      { href: "/videos", label: "视频生产" },
    ],
  },
  {
    title: "引擎",
    items: [
      { href: "/tasks", label: "任务队列" },
      { href: "/sessions", label: "会话" },
      { href: "/cron", label: "定时任务" },
      { href: "/media", label: "媒体" },
      { href: "/logins", label: "登录态" },
      { href: "/config", label: "配置总览" },
    ],
  },
];

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <nav className="flex flex-wrap items-center gap-1 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <Link href="/" className="mr-2 text-sm font-semibold hover:opacity-80">
          小贝 · 控制台
        </Link>
        {NAV_GROUPS.map((group, gi) => (
          <span key={group.title} className="flex items-center gap-1">
            {gi > 0 && (
              <span className="mx-2 h-4 w-px bg-neutral-200 dark:bg-neutral-800" aria-hidden />
            )}
            <span className="mr-1 text-xs text-neutral-400">{group.title}</span>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-2.5 py-1 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </span>
        ))}
      </nav>
      <main className="flex-1 overflow-y-auto px-6 py-5">{children}</main>
    </div>
  );
}
