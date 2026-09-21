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

const SECRET = "middleware-test-secret";
const PULL_KEY = "middleware-pull-key";
const NOW = 1_000_000;
const originalEnv = {
  BOARD_SESSION_SECRET: process.env.BOARD_SESSION_SECRET,
  BOARD_PULL_KEY: process.env.BOARD_PULL_KEY,
};

beforeEach(() => {
  next.mockClear();
  process.env.BOARD_SESSION_SECRET = SECRET;
  process.env.BOARD_PULL_KEY = PULL_KEY;
});

afterEach(() => {
  if (originalEnv.BOARD_SESSION_SECRET === undefined) {
    delete process.env.BOARD_SESSION_SECRET;
  } else {
    process.env.BOARD_SESSION_SECRET = originalEnv.BOARD_SESSION_SECRET;
  }
  if (originalEnv.BOARD_PULL_KEY === undefined) {
    delete process.env.BOARD_PULL_KEY;
  } else {
    process.env.BOARD_PULL_KEY = originalEnv.BOARD_PULL_KEY;
  }
});

describe("middleware default export", () => {
  it("continues an authenticated request", () => {
    const now = Math.floor(Date.now() / 1000);
    const cookie = signCookie(SECRET, now, 60);
    const response = middleware(new Request("https://board.example/", {
      headers: { cookie: `board_session=${cookie}` },
    }));

    expect(response?.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 401 JSON for an unauthenticated API request", async () => {
    const response = middleware(new Request("https://board.example/api/comments"));

    expect(response?.status).toBe(401);
    expect(response?.headers.get("content-type")).toBe("application/json");
    expect(await response?.json()).toEqual({ error: "unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns the login page for an unauthenticated page request", async () => {
    const response = middleware(new Request("https://board.example/"));
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
      expect(middlewareVerifyCookie(SECRET, value, NOW)).toBe(
        sharedVerifyCookie(SECRET, value, NOW),
      );
    }
  });

  it("matches the shared cookie and pull-key decisions", () => {
    const cookie = signCookie(SECRET, NOW, 60);
    const cases: { web: Record<string, string>; bag: Record<string, string> }[] = [
      { web: { cookie: `board_session=${cookie}` }, bag: { cookie: `board_session=${cookie}` } },
      { web: { "x-board-key": PULL_KEY }, bag: { "x-board-key": PULL_KEY } },
      { web: { "x-board-key": "wrong" }, bag: { "x-board-key": "wrong" } },
      { web: {}, bag: {} },
    ];
    const env = { BOARD_SESSION_SECRET: SECRET, BOARD_PULL_KEY: PULL_KEY };
    for (const item of cases) {
      expect(middlewareIsAuthed(env, new Headers(item.web), NOW)).toBe(
        sharedIsAuthed(env, item.bag, NOW),
      );
    }
  });
});
