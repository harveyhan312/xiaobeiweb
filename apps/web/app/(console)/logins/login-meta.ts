// /logins 页共用元数据：服务端 page.tsx 与客户端 logins-board.tsx 共用（纯常量，非组件）。
import type { LoginState } from "@/lib/xiaobei-logins";

export const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  kuaishou: "快手",
  bilibili: "B 站",
  "xhs-browse": "小红书（浏览）",
  "xhs-publish": "小红书（创作）",
  wx_mp: "公众号",
};

// server-expired = 第六状态：本地判定未过期但服务端 pong 失效（探活结论优先于本地）
export type CardState = LoginState | "server-expired";

export const STATE_META: Record<CardState, { label: string; cls: string; dot: string }> = {
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
  "server-expired": {
    label: "服务端已失效",
    cls: "border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950",
    dot: "bg-red-600",
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

export const ALERT_STATES: LoginState[] = ["expired", "expiring", "not-logged-in"];
