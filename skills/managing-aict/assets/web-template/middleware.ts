// Vercel Middleware — the auth gate for the private board.
//
// This file is intentionally SELF-CONTAINED (it inlines cookie verification,
// the gate decision, and the login page). It does NOT import from ./lib.
// Reason, found in the real-Vercel e2e: the Node.js middleware runtime fails
// to load relative ./lib/*.ts imports (every request 500s with
// MIDDLEWARE_INVOCATION_FAILED), even though `node:crypto` and an import-free
// middleware both work. The api/* functions bundle ./lib fine; middleware does
// not — so this logic is duplicated here on purpose. Keep the cookie/auth
// logic here in sync with lib/auth.ts.
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
// `next()` is how Vercel middleware CONTINUES to the origin (static board /
// api function). Returning `undefined` does NOT continue — it yields an empty
// 200 that swallows every allowed request (found in the real-Vercel e2e).
import { next } from "@vercel/edge";

export const config = { runtime: "nodejs", matcher: "/((?!_next|favicon).*)" };

const COOKIE_NAME = "board_session";
const HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function tseq(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function verifyCookie(secret: string, value: string, now: number): boolean {
  const dot = value.lastIndexOf(".");
  if (dot < 0) return false;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!tseq(sig, expected)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof exp === "number" && now < exp;
  } catch {
    return false;
  }
}

export function isAuthed(
  env: Record<string, string | undefined>,
  headers: Headers,
  now: number,
): boolean {
  const key = headers.get("x-board-key");
  if (key && env.BOARD_PULL_KEY && tseq(key, env.BOARD_PULL_KEY)) return true;
  const cookie = readCookie(headers.get("cookie"), COOKIE_NAME);
  return !!(cookie && env.BOARD_SESSION_SECRET && verifyCookie(env.BOARD_SESSION_SECRET, cookie, now));
}

// Keep this self-contained copy in sync with lib/loginPage.ts. The middleware
// runtime cannot import that module, as documented at the top of this file.
function loginPageHtml(showInvalidPassword = false): string {
  const error = showInvalidPassword
    ? '<p class="err" role="alert">Incorrect password. Try again.</p>'
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Board — password required</title><style>body{font:16px system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7f9}form{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 1px 8px rgba(0,0,0,.08);width:min(92vw,340px)}h1{font-size:1.1rem;margin:0 0 1rem}label{display:block;font-size:.85rem;color:#444;margin-bottom:.4rem}input{width:100%;box-sizing:border-box;font-size:1.1rem;padding:.7rem;border:1px solid #ccc;border-radius:8px}button{width:100%;margin-top:1rem;font-size:1rem;padding:.7rem;border:0;border-radius:8px;background:#2563eb;color:#fff}p.err{color:#b91c1c;font-size:.85rem;margin:.6rem 0 0}</style></head><body><form method="POST" action="/api/login"><h1>This board is private</h1><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus>${error}<button type="submit">Open board</button></form></body></html>`;
}

export default function middleware(request: Request): Response | undefined {
  const url = new URL(request.url);
  const now = Math.floor(Date.now() / 1000);
  const authed = isAuthed(process.env as Record<string, string | undefined>, request.headers, now);
  if (authed) return next(); // continue to the static board / functions
  const p = url.pathname;
  // login/logout must be reachable pre-auth
  if (p === "/api/login" || p === "/api/logout") return next();
  // unauthenticated API → 401 JSON (never the login HTML: an HTML 200 would be
  // read as success and silently drop a collaborator's comment)
  if (p.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json", ...HEADERS },
    });
  }
  // unauthenticated page → the login page
  return new Response(loginPageHtml(), {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8", ...HEADERS },
  });
}
