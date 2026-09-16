// 登录态只读数据层：读 ~/.openclaw/logins/<platform>.json 元数据，本地 Tier1 判定。
// 铁律：只读；API/UI 只出元数据（cookie name 存在性 / expires / updated_at），绝不回显 cookie value。
//
// 判定基准（与 agent 侧对齐，来源：crews/main/skills/_shared/check-session.ts presenceCheck、
// expert-xhs/tools/xhs-publish/scripts/creator-session.ts CREATOR_SESSION_KEYS）。
// 偏离计划说明：不 execFile 调 check-login.ts——其 SESSIONS_DIR 写死 ~/.openclaw/logins，
// 不认 OPENCLAW_STATE_DIR（sandbox 夹具无法驱动），且预警本就只需 expires 元数据。

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = process.env.OPENCLAW_STATE_DIR ?? join(homedir(), ".openclaw");
const LOGINS_DIR = join(STATE_DIR, "logins");

// 临期阈值：≤7 天内到期视为临期（计划 §7.2）
const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

// Tier1 必需 cookie 键：all = 全部存在才算有会话，any = 任一存在即可
const TIER1: Record<string, { mode: "all" | "any"; keys: string[] }> = {
  douyin: { mode: "all", keys: ["sessionid", "sid_tt", "uid_tt"] },
  bilibili: { mode: "any", keys: ["SESSDATA", "DedeUserID"] },
  kuaishou: {
    mode: "any",
    keys: ["kuaishou.server.webday7_st", "userId", "kuaishou.server.webday7_ph", "passToken"],
  },
  "xhs-browse": { mode: "any", keys: ["web_session"] },
  "xhs-publish": {
    mode: "any",
    keys: [
      "galaxy_creator_session_id",
      "galaxy.creator.beaker.session.id",
      "access-token-creator.xiaohongshu.com",
      "customer-sso-sid",
    ],
  },
  // wx_mp 登录由微信平台自管，键表无公开约定——文件在且含 cookie 即视为有会话
  wx_mp: { mode: "any", keys: [] },
};

export type LoginState = "valid" | "expiring" | "expired" | "not-logged-in" | "no-data";

export type LoginStatus = {
  platform: string;
  state: LoginState;
  updatedAt: string | null;
  maxExpiresAtMs: number | null;
  /** 仅 cookie name 列表（元数据），绝不包含 value */
  cookieNames: string[];
  /** true = 关键 cookie 全为会话 cookie（expires<=0），本地无法预警过期 */
  sessionOnly: boolean;
};

type CookieRecord = { name?: unknown; expires?: unknown };

function readLoginFile(platform: string): { cookies: CookieRecord[]; updatedAt: string | null } | null {
  const file = join(LOGINS_DIR, `${platform}.json`);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as
      | { cookies?: CookieRecord[]; updated_at?: unknown }
      | CookieRecord[];
    const arr = Array.isArray(raw) ? raw : (raw.cookies ?? []);
    const updatedAt =
      !Array.isArray(raw) && typeof raw.updated_at === "string" ? raw.updated_at : null;
    return { cookies: arr.filter((c) => c && typeof c === "object"), updatedAt };
  } catch {
    return null;
  }
}

function namesOf(cookies: CookieRecord[]): string[] {
  return cookies
    .map((c) => (typeof (c as CookieRecord).name === "string" ? ((c as CookieRecord).name as string) : ""))
    .filter((n) => n !== "");
}

function presenceState(platform: string, names: Set<string>): { present: boolean; missing: string[] } {
  const tier = TIER1[platform] ?? { mode: "any" as const, keys: [] };
  if (tier.keys.length === 0) {
    return { present: names.size > 0, missing: [] };
  }
  if (tier.mode === "all") {
    const missing = tier.keys.filter((k) => !names.has(k));
    return { present: missing.length === 0, missing };
  }
  const present = tier.keys.some((k) => names.has(k));
  return { present, missing: present ? [] : [...tier.keys] };
}

export function getLoginStatuses(): LoginStatus[] {
  return Object.keys(TIER1).map((platform) => {
    const data = readLoginFile(platform);
    if (!data) {
      return { platform, state: "no-data" as const, updatedAt: null, maxExpiresAtMs: null, cookieNames: [], sessionOnly: false };
    }
    const names = new Set(namesOf(data.cookies));
    if (names.size === 0) {
      return { platform, state: "no-data" as const, updatedAt: data.updatedAt, maxExpiresAtMs: null, cookieNames: [], sessionOnly: false };
    }

    const check = presenceState(platform, names);
    if (!check.present) {
      return {
        platform,
        state: "not-logged-in" as const,
        updatedAt: data.updatedAt,
        maxExpiresAtMs: null,
        cookieNames: [...names],
        sessionOnly: false,
      };
    }

    // 关键 cookie 的 expires（epoch 秒；<=0 = 会话 cookie，无法本地预警）
    const tier = TIER1[platform];
    const keyCookies = tier.keys.length === 0
      ? data.cookies
      : data.cookies.filter((c) => typeof c.name === "string" && tier.keys.includes(c.name));
    const expirations = keyCookies
      .map((c) => (typeof c.expires === "number" ? c.expires : 0))
      .filter((e) => e > 0);
    const sessionOnly = expirations.length === 0;
    const maxExpiresAtMs = expirations.length > 0 ? Math.max(...expirations) * 1000 : null;

    let state: LoginState;
    if (maxExpiresAtMs === null) {
      state = "valid"; // 会话 cookie 无过期时间，本地无预警依据（已知误差，pong 探活留 v2）
    } else if (maxExpiresAtMs < Date.now()) {
      state = "expired";
    } else if (maxExpiresAtMs - Date.now() <= EXPIRING_SOON_MS) {
      state = "expiring";
    } else {
      state = "valid";
    }

    return { platform, state, updatedAt: data.updatedAt, maxExpiresAtMs, cookieNames: [...names], sessionOnly };
  });
}

export function summarizeLoginStatuses(statuses: LoginStatus[]): Record<LoginState, number> {
  const summary: Record<LoginState, number> = {
    valid: 0,
    expiring: 0,
    expired: 0,
    "not-logged-in": 0,
    "no-data": 0,
  };
  for (const s of statuses) summary[s.state] += 1;
  return summary;
}
