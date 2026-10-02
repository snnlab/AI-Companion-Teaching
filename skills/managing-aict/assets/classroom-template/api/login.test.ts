import { describe, it, expect } from "vitest";
import { run, isLogout } from "./login";

const env = { BOARD_PASSWORD: "correct-horse", BOARD_SESSION_SECRET: "sess" };
const now = 1_000_000;

describe("login", () => {
  it("sets an instructor_session cookie and redirects on correct password", () => {
    const result = run({ password: "correct-horse" }, env, now);
    expect(result.status).toBe(303);
    expect(result.setCookie).toContain("instructor_session=");
    expect(result.setCookie).toContain("HttpOnly");
  });
  it("re-serves the login page (no cookie) on wrong password", () => {
    const result = run({ password: "wrong" }, env, now);
    expect(result.status).toBe(401);
    expect(result.html).toBeTruthy();
    expect(result.html).toContain('role="alert"');
    expect(result.html).toContain("Incorrect password. Try again.");
    expect(result.setCookie).toBeUndefined();
  });
});

describe("logout (rewritten to this function)", () => {
  it("is recognised by the rewrite's query or by the original path", () => {
    expect(isLogout("/api/login?logout=1", { logout: "1" })).toBe(true);
    expect(isLogout("/api/logout", {})).toBe(true);
    expect(isLogout("/api/login", {})).toBe(false);
    expect(isLogout(undefined, {})).toBe(false);
  });
});
