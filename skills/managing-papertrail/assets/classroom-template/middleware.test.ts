import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { next } = vi.hoisted(() => ({
  next: vi.fn(() => new Response(null, { status: 204 })),
}));
vi.mock("@vercel/edge", () => ({ next }));

import middleware, {
  isAuthed as middlewareIsAuthed,
  verifyCookie as middlewareVerifyCookie,
} from "./middleware";
import {
  isAuthed as sharedIsAuthed,
  signCookie,
  verifyCookie as sharedVerifyCookie,
} from "./lib/auth";
import { gateDecision } from "./lib/gate";

const SECRET = "middleware-test-secret";
const NOW = 1_000_000;
const originalSecret = process.env.BOARD_SESSION_SECRET;

beforeEach(() => {
  next.mockClear();
  process.env.BOARD_SESSION_SECRET = SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.BOARD_SESSION_SECRET;
  else process.env.BOARD_SESSION_SECRET = originalSecret;
});

describe("middleware default export", () => {
  it("continues an authenticated request", () => {
    const now = Math.floor(Date.now() / 1000);
    const cookie = signCookie(SECRET, now, 60);
    const response = middleware(new Request("https://roster.example/", {
      headers: { cookie: `instructor_session=${cookie}` },
    }));
    expect(response?.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("continues an unauthenticated POST to /api/submissions (bearer route)", () => {
    const response = middleware(new Request("https://roster.example/api/submissions", { method: "POST" }));
    expect(response?.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 401 JSON for an unauthenticated instructor API request", async () => {
    const response = middleware(new Request("https://roster.example/api/roster"));
    expect(response?.status).toBe(401);
    expect(response?.headers.get("content-type")).toBe("application/json");
    expect(await response?.json()).toEqual({ error: "unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("gates /api/submissions/:studentId behind the instructor cookie (not the bearer exemption)", async () => {
    const response = middleware(new Request("https://roster.example/api/submissions/alice"));
    expect(response?.status).toBe(401);
    expect(response?.headers.get("content-type")).toBe("application/json");
    expect(next).not.toHaveBeenCalled();
  });

  it("continues an unauthenticated GET/POST to /api/comments (bearer route, checked in the handler itself)", () => {
    const get = middleware(new Request("https://roster.example/api/comments?shareHash=x"));
    expect(get?.status).toBe(204);
    const post = middleware(new Request("https://roster.example/api/comments", { method: "POST" }));
    expect(post?.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("continues an unauthenticated GET to /api/my-comments (bearer-only route, checked in the handler itself)", () => {
    const response = middleware(new Request("https://roster.example/api/my-comments"));
    expect(response?.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("continues an unauthenticated request to the student feedback page and its push assets", () => {
    for (const p of ["/me", "/me.html", "/sw.js", "/api/vapid-public-key", "/api/push-subscribe"]) {
      expect(middleware(new Request(`https://roster.example${p}`, { method: p === "/api/push-subscribe" ? "POST" : "GET" }))?.status).toBe(204);
    }
    expect(next).toHaveBeenCalledTimes(5);
  });

  it("returns the login page for an unauthenticated page request", async () => {
    const response = middleware(new Request("https://roster.example/"));
    const html = await response?.text();
    expect(response?.status).toBe(401);
    expect(response?.headers.get("content-type")).toContain("text/html");
    expect(html).toContain('action="/api/login"');
    expect(html).not.toContain("Incorrect password. Try again.");
    expect(next).not.toHaveBeenCalled();
  });
});

describe("inlined auth parity", () => {
  it("matches the shared cookie verification", () => {
    const fresh = signCookie(SECRET, NOW, 60);
    const expired = signCookie(SECRET, NOW - 120, 60);
    for (const value of [fresh, expired, "bad-cookie"]) {
      expect(middlewareVerifyCookie(SECRET, value, NOW)).toBe(sharedVerifyCookie(SECRET, value, NOW));
    }
  });

  it("matches the shared cookie decision", () => {
    const cookie = signCookie(SECRET, NOW, 60);
    const env = { BOARD_SESSION_SECRET: SECRET };
    const cases: { web: Record<string, string>; bag: Record<string, string> }[] = [
      { web: { cookie: `instructor_session=${cookie}` }, bag: { cookie: `instructor_session=${cookie}` } },
      { web: {}, bag: {} },
    ];
    for (const item of cases) {
      expect(middlewareIsAuthed(env, new Headers(item.web), NOW)).toBe(sharedIsAuthed(env, item.bag, NOW));
    }
  });

  it("matches lib/gate.ts's gateDecision for the exempt/gated route split", () => {
    const routes = ["/api/login", "/api/logout", "/api/submissions", "/api/submissions/alice", "/api/comments", "/api/my-comments", "/api/push-subscribe", "/api/vapid-public-key", "/me", "/me.html", "/sw.js", "/api/roster", "/"];
    for (const pathname of routes) {
      const response = middleware(new Request(`https://roster.example${pathname}`));
      const decision = gateDecision(pathname, "GET", false);
      if (decision.action === "allow") expect(response?.status).toBe(204);
      else if (decision.action === "unauthorizedJson") expect(response?.status).toBe(401);
      else expect(response?.status).toBe(401); // loginPage also 401s, distinguished by content-type
    }
  });
});
