// Vercel Middleware — the instructor auth gate for the classroom roster
// server.
//
// This file is intentionally SELF-CONTAINED (it inlines cookie verification,
// the gate decision, and the login page), exactly as
// web-template/middleware.ts does, and for the same documented reason: the
// Node.js middleware runtime fails to load relative ./lib/*.ts imports
// (every request 500s with MIDDLEWARE_INVOCATION_FAILED), even though
// `node:crypto` and an import-free middleware both work. The api/* functions
// bundle ./lib fine; middleware does not — so this logic is duplicated here
// on purpose. Keep the cookie/auth logic here in sync with lib/auth.ts, and
// the route-exemption logic in sync with lib/gate.ts's gateDecision (which
// is unit-tested; this copy is only exercised by middleware.test.ts).
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
// `next()` is how Vercel middleware CONTINUES to the origin (api function).
// Returning `undefined` does NOT continue — it yields an empty 200 that
// swallows every allowed request (found in web-template's real-Vercel e2e).
import { next } from "@vercel/edge";

export const config = { runtime: "nodejs", matcher: "/((?!_next|favicon).*)" };

const COOKIE_NAME = "instructor_session";
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
  const cookie = readCookie(headers.get("cookie"), COOKIE_NAME);
  return !!(cookie && env.BOARD_SESSION_SECRET && verifyCookie(env.BOARD_SESSION_SECRET, cookie, now));
}

// Routes reachable without the instructor cookie. Keep in sync with
// lib/gate.ts's gateDecision.
function isPreAuthRoute(pathname: string): boolean {
  return pathname === "/api/login" || pathname === "/api/logout";
}

// The student-facing feedback page and its assets. None of these carry an
// instructor session or a server-rendered secret:
//  - /me, /me.html  — a static shell that calls GET /api/my-comments with
//    the student's own bearer token.
//  - /sw.js         — the push service worker (static JS, no secret).
//  - /api/vapid-public-key — the VAPID *public* key (public by definition).
// Served at "/me" via a vercel.json rewrite to "/me.html".
function isStudentPageRoute(pathname: string): boolean {
  return (
    pathname === "/me" ||
    pathname === "/me.html" ||
    pathname === "/sw.js" ||
    pathname === "/api/vapid-public-key"
  );
}

// POST /api/submissions is the student intake route: its only credential is
// the `Authorization: Bearer <token>` header, verified inside the handler
// itself (lib/roster.ts's resolveToken). Students never get a cookie this
// round, so this route must never be routed into the instructor login page.
//
// GET/POST /api/comments serves both an instructor's browser session AND a
// student's own bearer token (reading their own submission's comments) —
// api/comments.ts does its own instructor-vs-bearer authorization per
// method, exactly as api/submissions.ts does for the bearer-only route
// above. Keep this in sync with lib/gate.ts's gateDecision, which makes the
// identical exemption for the identical reason.
//
// GET /api/my-comments is bearer-only (no instructor session concept at
// all) — a student's own comments across every one of their submissions.
// api/my-comments.ts does its own token resolution; same reason for the
// exemption as the two routes above.
function isBearerTokenRoute(pathname: string): boolean {
  return (
    pathname === "/api/submissions" ||
    pathname === "/api/comments" ||
    pathname === "/api/my-comments" ||
    pathname === "/api/push-subscribe"
  );
}

// Keep this self-contained copy in sync with lib/loginPage.ts. The
// middleware runtime cannot import that module, as documented at the top of
// this file.
function loginPageHtml(showInvalidPassword = false): string {
  const error = showInvalidPassword
    ? '<p class="err" role="alert">Incorrect password. Try again.</p>'
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Roster — instructor sign-in</title><style>body{font:16px system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7f9}form{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 1px 8px rgba(0,0,0,.08);width:min(92vw,340px)}h1{font-size:1.1rem;margin:0 0 1rem}label{display:block;font-size:.85rem;color:#444;margin-bottom:.4rem}input{width:100%;box-sizing:border-box;font-size:1.1rem;padding:.7rem;border:1px solid #ccc;border-radius:8px}button{width:100%;margin-top:1rem;font-size:1rem;padding:.7rem;border:0;border-radius:8px;background:#2563eb;color:#fff}p.err{color:#b91c1c;font-size:.85rem;margin:.6rem 0 0}</style></head><body><form method="POST" action="/api/login"><h1>Instructor sign-in</h1><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus>${error}<button type="submit">Open roster</button></form></body></html>`;
}

export default function middleware(request: Request): Response | undefined {
  const url = new URL(request.url);
  const now = Math.floor(Date.now() / 1000);
  const p = url.pathname;

  if (isPreAuthRoute(p) || isStudentPageRoute(p) || isBearerTokenRoute(p)) return next();

  const authed = isAuthed(process.env as Record<string, string | undefined>, request.headers, now);
  if (authed) return next(); // continue to the api function

  // unauthenticated API → 401 JSON (never the login HTML: an HTML 200 would
  // be read as success and silently drop an instructor request)
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
