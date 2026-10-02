import type { VercelRequest, VercelResponse } from "@vercel/node";
import { signCookie, cookieHeader, clearCookieHeader, timingSafeEqualStr } from "../lib/auth.js";
import { SECURITY_HEADERS } from "../lib/gate.js";
import { loginPageHtml } from "../lib/loginPage.js";

export interface LoginResult { status: number; html?: string; location?: string; setCookie?: string }

export function run(body: unknown, env: Record<string, string | undefined>, now: number): LoginResult {
  let pw = "";
  if (body && typeof body === "object" && !Array.isArray(body)) pw = String((body as Record<string, unknown>).password ?? "");
  else if (typeof body === "string") pw = new URLSearchParams(body).get("password") ?? "";
  const expected = env.BOARD_PASSWORD ?? "";
  if (expected && timingSafeEqualStr(pw, expected)) {
    return { status: 303, location: "/", setCookie: cookieHeader(signCookie(env.BOARD_SESSION_SECRET as string, now)) };
  }
  return { status: 401, html: loginPageHtml(true) };
}

// /api/logout is served here too (vercel.json rewrites it to /api/login
// ?logout=1): one function fewer, to stay under the Hobby plan's 12-function
// limit. Either signal counts — the rewritten query or the original path.
export function isLogout(url: string | undefined, query: Record<string, unknown>): boolean {
  return query.logout !== undefined || (url ?? "").split("?")[0].endsWith("/logout");
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (isLogout(req.url, (req.query ?? {}) as Record<string, unknown>)) {
    // Intentionally method-agnostic: no client code calls this endpoint.
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    res.setHeader("Set-Cookie", clearCookieHeader());
    res.status(200).json({ ok: true });
    return;
  }
  const r = run(req.body, process.env, Math.floor(Date.now() / 1000));
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (r.setCookie) res.setHeader("Set-Cookie", r.setCookie);
  if (r.location) res.setHeader("Location", r.location);
  res.status(r.status);
  if (r.html !== undefined) { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.send(r.html); }
  else res.end();
}
