import { describe, it, expect } from "vitest";
import { run } from "./login";

const env = { BOARD_PASSWORD: "correct-horse", BOARD_SESSION_SECRET: "sess" };
const now = 1_000_000;

describe("login", () => {
  it("sets a cookie and redirects on correct password", () => {
    const result = run({ password: "correct-horse" }, env, now);
    expect(result.status).toBe(303);
    expect(result.setCookie).toContain("board_session=");
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
