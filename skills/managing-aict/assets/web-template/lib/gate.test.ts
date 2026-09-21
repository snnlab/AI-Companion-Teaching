import { describe, it, expect } from "vitest";
import { gateDecision } from "./gate";

describe("gateDecision", () => {
  it("allows any request when authed", () => {
    expect(gateDecision("/", "GET", true).action).toBe("allow");
    expect(gateDecision("/api/comments", "POST", true).action).toBe("allow");
  });
  it("always allows the login + logout endpoints (pre-auth)", () => {
    expect(gateDecision("/api/login", "POST", false).action).toBe("allow");
    expect(gateDecision("/api/logout", "POST", false).action).toBe("allow");
  });
  it("serves the login PAGE for an unauthenticated page request", () => {
    expect(gateDecision("/", "GET", false).action).toBe("loginPage");
    expect(gateDecision("/index.html", "GET", false).action).toBe("loginPage");
  });
  it("returns 401 JSON for an unauthenticated API request (never login HTML)", () => {
    expect(gateDecision("/api/comments", "GET", false).action).toBe("unauthorizedJson");
    expect(gateDecision("/api/comments", "POST", false).action).toBe("unauthorizedJson");
  });
});
