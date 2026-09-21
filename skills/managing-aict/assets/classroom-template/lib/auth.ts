import { createHmac, timingSafeEqual, createHash } from "node:crypto";

// Distinct from web-template's `board_session` cookie NAME by design (not
// just a different secret) — so a future student-facing browser session, if
// one is ever added, can never collide with the instructor's cookie on the
// same browser. Students authenticate to this template with a bearer token
// only (see lib/roster.ts); they never receive a cookie this round.
const COOKIE_NAME = "instructor_session";
const DEFAULT_TTL = 30 * 24 * 3600; // 30 days

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  // Hash both sides so lengths always match (timingSafeEqual throws otherwise).
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// `sub` names the cookie's subject. Only "instructor" exists this round —
// students never get a browser session here, only the bearer token verified
// in lib/roster.ts. The field is carried now so a future student session
// type could be added without changing this payload shape; route gating
// still keys off the cookie NAME (instructor_session), never `sub`, exactly
// so the two can never be confused on the same browser.
export function signCookie(
  secret: string,
  now: number,
  ttlSeconds = DEFAULT_TTL,
  sub = "instructor",
): string {
  const payload = b64url(JSON.stringify({ iat: now, exp: now + ttlSeconds, sub }));
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyCookie(secret: string, cookieValue: string, now: number): boolean {
  const dot = cookieValue.lastIndexOf(".");
  if (dot < 0) return false;
  const payload = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!timingSafeEqualStr(sig, expected)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof exp === "number" && now < exp;
  } catch {
    return false;
  }
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function cookieHeader(value: string, ttlSeconds = DEFAULT_TTL): string {
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ttlSeconds}`;
}

export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

// A plain header bag as delivered by a Node request (`req.headers`), with
// lowercased keys. Accepting this (rather than a Web `Headers`) lets isAuthed
// run inside a classic Node function handler — the shape Vercel actually
// invokes (found in web-template's real-Vercel e2e; carried over here).
export type HeaderBag = Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderBag, name: string): string | null {
  const v = headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

// Instructor-only. There is no classroom-template equivalent of
// web-template's BOARD_PULL_KEY machine-to-machine header this round — the
// only non-cookie credential anywhere in this template is the student
// bearer token, and that is verified separately by lib/roster.ts's
// resolveToken (POST /api/submissions), never here.
export function isAuthed(
  env: { BOARD_SESSION_SECRET?: string },
  headers: HeaderBag,
  now: number,
): boolean {
  const cookie = readCookie(headerValue(headers, "cookie"), COOKIE_NAME);
  return !!(cookie && env.BOARD_SESSION_SECRET && verifyCookie(env.BOARD_SESSION_SECRET, cookie, now));
}
