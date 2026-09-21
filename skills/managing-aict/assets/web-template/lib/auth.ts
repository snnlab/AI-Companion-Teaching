import { createHmac, timingSafeEqual, createHash } from "node:crypto";

const COOKIE_NAME = "board_session";
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

export function signCookie(secret: string, now: number, ttlSeconds = DEFAULT_TTL): string {
  const payload = b64url(JSON.stringify({ iat: now, exp: now + ttlSeconds }));
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
// invokes (the Web Handler `export function GET/POST` pattern is not dispatched
// by the Node launcher; this was found in the real-Vercel e2e).
export type HeaderBag = Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderBag, name: string): string | null {
  const v = headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export function isAuthed(
  env: { BOARD_SESSION_SECRET?: string; BOARD_PULL_KEY?: string },
  headers: HeaderBag,
  now: number,
): boolean {
  const key = headerValue(headers, "x-board-key");
  if (key && env.BOARD_PULL_KEY && timingSafeEqualStr(key, env.BOARD_PULL_KEY)) return true;
  const cookie = readCookie(headerValue(headers, "cookie"), COOKIE_NAME);
  if (cookie && env.BOARD_SESSION_SECRET && verifyCookie(env.BOARD_SESSION_SECRET, cookie, now)) {
    return true;
  }
  return false;
}
