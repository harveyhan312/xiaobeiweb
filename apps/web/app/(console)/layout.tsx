import Link from "next/link";
import type { ReactNode } from "react";

const NAV = [
  { href: "/", label: "聊天" },
  { href: "/tasks", label: "任务队列" },
  { href: "/sessions", label: "会话" },
  { href: "/cron", label: "定时任务" },
  { href: "/media", label: "媒体" },
  { href: "/config", label: "配置总览" },
];

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <nav className="flex items-center gap-1 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <span className="mr-3 text-sm font-semibold">小贝 · 控制台</span>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <main className="flex-1 overflow-y-auto px-6 py-5">{children}</main>
    </div>
  );
}
