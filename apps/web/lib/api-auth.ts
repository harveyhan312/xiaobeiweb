// BFF 最小鉴权（审核 F1）：server 只绑 127.0.0.1（OS 层隔离 LAN），
// 本模块对全部 /api 路由做第二、三层校验：XFF 非环回拒绝（纵深）+ 共享令牌。
// 令牌来源：env XB_WEB_TOKEN → .env.local 文件（首次缺失时自动生成并追加）。
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync, appendFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

const TOKEN_KEY = "XB_WEB_TOKEN";
const ENV_FILE = join(process.cwd(), ".env.local");

let loggedProvision = false;

function sha256(v: string): Buffer {
  return createHash("sha256").update(v).digest();
}

function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  return timingSafeEqual(sha256(a), sha256(b));
}

function parseEnvFileToken(): string | null {
  if (!existsSync(ENV_FILE)) return null;
  try {
    const m = readFileSync(ENV_FILE, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith(`${TOKEN_KEY}=`));
    if (!m) return null;
    const raw = m.slice(TOKEN_KEY.length + 1).trim();
    return raw.replace(/^["']|["']$/g, "") || null;
  } catch {
    return null;
  }
}

// 首次缺失时生成并追加进 .env.local（gitignored）；当前进程内兜底记忆
let memoizedToken: string | null | undefined;

export function resolveApiToken(): string | null {
  if (memoizedToken !== undefined) return memoizedToken;
  const fromEnv = process.env[TOKEN_KEY];
  if (fromEnv) {
    memoizedToken = fromEnv;
    return memoizedToken;
  }
  const fromFile = parseEnvFileToken();
  if (fromFile) {
    memoizedToken = fromFile;
    return memoizedToken;
  }
  const generated = createHash("sha256")
    .update(`${process.pid}-${Date.now()}-${Math.random()}`)
    .digest("base64url");
  try {
    appendFileSync(ENV_FILE, `\n${TOKEN_KEY}=${generated}\n`, { mode: 0o600 });
    // mode 仅在新建文件时生效；向既有文件追加后补一次收紧
    try {
      chmodSync(ENV_FILE, 0o600);
    } catch {
      // 收紧失败不影响功能
    }
    memoizedToken = generated;
    if (!loggedProvision) {
      loggedProvision = true;
      console.log(
        `[xiaobei-web] 已生成 API 访问令牌并写入 ${ENV_FILE}（${TOKEN_KEY}）。` +
          `浏览器首次使用时按提示粘贴即可。`,
      );
    }
    return memoizedToken;
  } catch {
    // .env.local 只读等异常时退化为进程内令牌（重启会变，浏览器需重新粘贴）
    memoizedToken = generated;
    return memoizedToken;
  }
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// Next 仅在客户端未自带 XFF 时以 socket 地址填充——存在伪造可能，
// 故仅作纵深（非环回拒绝），真正的边界是 -H 127.0.0.1 绑定 + 令牌。
function xffLooksRemote(req: Request): boolean {
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return false;
  const first = xff.split(",")[0].trim();
  return first !== "" && !LOOPBACK.has(first);
}

function readCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export type AuthFailure = { status: 401 | 403 | 500; body: { error: string; code: string } };

export function checkApiAuth(req: Request): AuthFailure | null {
  if (xffLooksRemote(req)) {
    return { status: 403, body: { error: "仅允许本机访问", code: "FORBIDDEN_REMOTE" } };
  }
  const expected = resolveApiToken();
  if (!expected) {
    return { status: 500, body: { error: "令牌初始化失败", code: "TOKEN_UNAVAILABLE" } };
  }
  const provided = req.headers.get("x-xb-token") ?? readCookie(req, "xb_token") ?? "";
  if (!constantTimeEqual(provided, expected)) {
    return { status: 401, body: { error: "缺少或错误的访问令牌", code: "NEEDS_TOKEN" } };
  }
  return null;
}

export function authDeniedResponse(failure: AuthFailure): Response {
  return new Response(JSON.stringify(failure.body), {
    status: failure.status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
