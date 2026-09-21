export function gateDecision(
  pathname: string,
  _method: string,
  authed: boolean,
): { action: "allow" | "loginPage" | "unauthorizedJson" } {
  if (authed) return { action: "allow" };
  if (pathname === "/api/login" || pathname === "/api/logout") return { action: "allow" };
  if (pathname.startsWith("/api/")) return { action: "unauthorizedJson" };
  return { action: "loginPage" };
}

export const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
