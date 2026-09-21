import type { VercelRequest, VercelResponse } from "@vercel/node";
import { signCookie, cookieHeader, timingSafeEqualStr } from "../lib/auth.js";
import { SECURITY_HEADERS } from "../lib/gate.js";
import { loginPageHtml } from "../lib/loginPage.js";

export interface LoginResult { status: number; html?: string; location?: string; setCookie?: string; }

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

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const r = run(req.body, process.env, Math.floor(Date.now() / 1000));
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (r.setCookie) res.setHeader("Set-Cookie", r.setCookie);
  if (r.location) res.setHeader("Location", r.location);
  res.status(r.status);
  if (r.html !== undefined) { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.send(r.html); }
  else res.end();
}
