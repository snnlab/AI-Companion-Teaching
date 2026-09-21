import { describe, it, expect } from "vitest";
import { signCookie, verifyCookie, timingSafeEqualStr, isAuthed, cookieHeader, clearCookieHeader } from "./auth";

const SECRET = "test-session-secret-abc";
const NOW = 1_000_000; // seconds

describe("cookie", () => {
  it("verifies a fresh cookie", () => {
    const c = signCookie(SECRET, NOW, 3600);
    expect(verifyCookie(SECRET, c, NOW + 10)).toBe(true);
  });
  it("rejects an expired cookie by server-validated exp", () => {
    const c = signCookie(SECRET, NOW, 3600);
    expect(verifyCookie(SECRET, c, NOW + 3601)).toBe(false);
  });
  it("rejects a cookie signed with a different secret", () => {
    const c = signCookie("other-secret", NOW, 3600);
    expect(verifyCookie(SECRET, c, NOW + 10)).toBe(false);
  });
  it("rejects a tampered payload", () => {
    const c = signCookie(SECRET, NOW, 3600);
    const [, sig] = c.split(".");
    const forged = Buffer.from('{"iat":0,"exp":9999999999}').toString("base64url");
    expect(verifyCookie(SECRET, `${forged}.${sig}`, NOW)).toBe(false);
  });
  it("carries a sub=instructor claim by default", () => {
    const c = signCookie(SECRET, NOW, 3600);
    const [payload] = c.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    expect(decoded.sub).toBe("instructor");
  });
  it("uses the instructor_session cookie name, distinct from board_session", () => {
    const header = cookieHeader(signCookie(SECRET, NOW, 3600));
    expect(header).toContain("instructor_session=");
    expect(header).not.toContain("board_session=");
    expect(clearCookieHeader()).toContain("instructor_session=;");
  });
});

describe("timingSafeEqualStr", () => {
  it("true on equal, false on different (incl. different lengths)", () => {
    expect(timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false); // must not throw
  });
});

describe("isAuthed", () => {
  const env = { BOARD_SESSION_SECRET: SECRET };
  it("accepts a valid cookie", () => {
    const c = signCookie(SECRET, NOW, 3600);
    expect(isAuthed(env, { cookie: `instructor_session=${c}` }, NOW + 10)).toBe(true);
  });
  it("rejects when no cookie is present", () => {
    expect(isAuthed(env, {}, NOW)).toBe(false);
  });
  it("rejects a cookie under the wrong (web-template) name", () => {
    const c = signCookie(SECRET, NOW, 3600);
    expect(isAuthed(env, { cookie: `board_session=${c}` }, NOW + 10)).toBe(false);
  });
});
