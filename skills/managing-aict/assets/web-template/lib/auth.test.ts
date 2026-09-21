import { describe, it, expect } from "vitest";
import { signCookie, verifyCookie, timingSafeEqualStr, isAuthed } from "./auth";

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
    const [p, sig] = c.split(".");
    const forged = Buffer.from('{"iat":0,"exp":9999999999}').toString("base64url");
    expect(verifyCookie(SECRET, `${forged}.${sig}`, NOW)).toBe(false);
    expect(p).toBeTruthy();
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
  const env = { BOARD_SESSION_SECRET: SECRET, BOARD_PULL_KEY: "pull-123" };
  it("accepts a valid cookie", () => {
    const c = signCookie(SECRET, NOW, 3600);
    expect(isAuthed(env, { cookie: `board_session=${c}` }, NOW + 10)).toBe(true);
  });
  it("accepts a valid x-board-key", () => {
    expect(isAuthed(env, { "x-board-key": "pull-123" }, NOW)).toBe(true);
  });
  it("rejects when neither is valid", () => {
    expect(isAuthed(env, { "x-board-key": "wrong" }, NOW)).toBe(false);
    expect(isAuthed(env, {}, NOW)).toBe(false);
  });
});
