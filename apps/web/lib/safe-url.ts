// 仅放行 http(s) 到 <a href>；库内可能出现 javascript:/data: 等 URL，先在数据层出口置 null
export function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const trimmed = u.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}
