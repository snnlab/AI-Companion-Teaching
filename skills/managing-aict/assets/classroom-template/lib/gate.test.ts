import { describe, it, expect } from "vitest";
import { gateDecision } from "./gate";

describe("gateDecision", () => {
  it("allows any request when authed", () => {
    expect(gateDecision("/", "GET", true).action).toBe("allow");
    expect(gateDecision("/api/roster", "GET", true).action).toBe("allow");
  });
  it("always allows the login + logout endpoints (pre-auth)", () => {
    expect(gateDecision("/api/login", "POST", false).action).toBe("allow");
    expect(gateDecision("/api/logout", "POST", false).action).toBe("allow");
  });
  it("always allows POST /api/submissions without the instructor cookie (bearer route)", () => {
    expect(gateDecision("/api/submissions", "POST", false).action).toBe("allow");
    expect(gateDecision("/api/submissions", "GET", false).action).toBe("allow");
  });
  it("does NOT exempt /api/submissions/:studentId — that route is instructor-only", () => {
    expect(gateDecision("/api/submissions/alice", "GET", false).action).toBe("unauthorizedJson");
  });
  it("always allows /api/comments without the instructor cookie (student bearer token route too)", () => {
    expect(gateDecision("/api/comments", "GET", false).action).toBe("allow");
    expect(gateDecision("/api/comments", "POST", false).action).toBe("allow");
  });

  it("always allows GET /api/my-comments without the instructor cookie (bearer-only route)", () => {
    expect(gateDecision("/api/my-comments", "GET", false).action).toBe("allow");
  });
  it("always allows the student feedback page + its push assets pre-auth", () => {
    expect(gateDecision("/me", "GET", false).action).toBe("allow");
    expect(gateDecision("/me.html", "GET", false).action).toBe("allow");
    expect(gateDecision("/sw.js", "GET", false).action).toBe("allow");
    expect(gateDecision("/api/vapid-public-key", "GET", false).action).toBe("allow");
    expect(gateDecision("/api/push-subscribe", "POST", false).action).toBe("allow");
  });
  it("serves the login PAGE for an unauthenticated page request", () => {
    expect(gateDecision("/", "GET", false).action).toBe("loginPage");
    expect(gateDecision("/index.html", "GET", false).action).toBe("loginPage");
  });
  it("returns 401 JSON for an unauthenticated instructor API request", () => {
    expect(gateDecision("/api/roster", "GET", false).action).toBe("unauthorizedJson");
    expect(gateDecision("/api/similarity", "POST", false).action).toBe("unauthorizedJson");
  });
});
