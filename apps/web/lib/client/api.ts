"use client";

// 浏览器侧 API 访问：自动携带 x-xb-token；401 NEEDS_TOKEN 时提示粘贴一次，
// 存 localStorage 并镜像写 cookie（EventSource 无法带自定义头，走 cookie）。
const LS_KEY = "xb.web.token";

function mirrorCookie(token: string) {
  document.cookie = `xb_token=${encodeURIComponent(token)}; path=/; samesite=strict; max-age=31536000`;
}

export function getStoredToken(): string {
  return localStorage.getItem(LS_KEY) ?? "";
}

export function storeToken(token: string) {
  localStorage.setItem(LS_KEY, token);
  mirrorCookie(token);
}

export function tokenStored(): boolean {
  return getStoredToken() !== "";
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("x-xb-token", token);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    const body = (await res.clone().json().catch(() => null)) as { code?: string } | null;
    if (body?.code === "NEEDS_TOKEN") {
      const entered = window.prompt(
        "请输入本机 API 访问令牌（终端执行：\ngrep XB_WEB_TOKEN ~/Documents/Qoder/projects/xiaobei-web/apps/web/.env.local\n复制 = 后面的值粘贴到这里）",
      );
      if (entered && entered.trim()) {
        storeToken(entered.trim());
        return apiFetch(input, init);
      }
    }
  }
  return res;
}
