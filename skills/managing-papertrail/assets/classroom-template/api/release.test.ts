import { describe, it, expect, vi, beforeEach } from "vitest";

function streamOf(obj: unknown): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}

const { put, get, list, del, sendNotification } = vi.hoisted(() => ({
  put: vi.fn(async (_pathname: string, _body: string, _options?: Record<string, unknown>) => ({})),
  get: vi.fn(),
  list: vi.fn(async (): Promise<{ blobs: { pathname: string }[]; hasMore: boolean; cursor?: string }> => ({ blobs: [], hasMore: false })),
  del: vi.fn(async (_pathname: string, _options?: Record<string, unknown>) => ({})),
  sendNotification: vi.fn(async () => ({ statusCode: 201 })),
}));
vi.mock("@vercel/blob", () => ({ put, get, list, del }));
vi.mock("web-push", () => ({ default: { sendNotification, generateVAPIDKeys: vi.fn() } }));

import { run } from "./release";
import { signCookie } from "../lib/auth";

const SECRET = "instructor-secret";
const NOW = 1_000_000;
const ENV = { BLOB_READ_WRITE_TOKEN: "blob-tok", BOARD_SESSION_SECRET: SECRET, COURSE_INSTRUCTOR_NAME: "Prof. Kim" };
const VAPID_ENV = { ...ENV, VAPID_PUBLIC_KEY: "BPUB", VAPID_PRIVATE_KEY: "priv" };
const HASH = "a1b2c3d4e5f60718";

function authed() {
  return { cookie: `instructor_session=${signCookie(SECRET, NOW, 3600)}` };
}

function ownedHash() {
  get.mockImplementation(async (pathname: string) => {
    if (pathname === `submission-index/${HASH}.json`) {
      return { statusCode: 200, stream: streamOf({ studentId: "alice" }) };
    }
    return null;
  });
}

beforeEach(() => {
  put.mockClear(); get.mockReset(); list.mockReset(); del.mockClear(); sendNotification.mockClear();
  list.mockResolvedValue({ blobs: [], hasMore: false });
});

describe("POST /api/release", () => {
  it("rejects an unauthenticated request", async () => {
    const r = await run("POST", {}, {}, { shareHash: HASH }, ENV, NOW);
    expect(r).toEqual({ status: 401, json: { error: "unauthorized" } });
  });

  it("rejects a malformed shareHash", async () => {
    const r = await run("POST", authed(), {}, { shareHash: "nope" }, ENV, NOW);
    expect(r.status).toBe(400);
  });

  it("rejects a shareHash that names no known submission", async () => {
    get.mockResolvedValue(null); // submission-index miss
    const r = await run("POST", authed(), {}, { shareHash: HASH }, ENV, NOW);
    expect(r).toEqual({ status: 400, json: { error: "unknown shareHash" } });
  });

  it("writes a release marker and defaults the author to COURSE_INSTRUCTOR_NAME", async () => {
    ownedHash();
    const r = await run("POST", authed(), {}, { shareHash: HASH }, ENV, NOW);
    expect(r.status).toBe(200);
    expect((r.json as { ok: boolean }).ok).toBe(true);
    expect((r.json as { by: string }).by).toBe("Prof. Kim");
    const [pathname] = put.mock.calls[0];
    expect(pathname).toBe(`release/${HASH}.json`);
  });

  it("does not push when VAPID is not configured (push: null)", async () => {
    ownedHash();
    const r = await run("POST", authed(), {}, { shareHash: HASH }, ENV, NOW);
    expect((r.json as { push: unknown }).push).toBeNull();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("web-pushes the owning student when VAPID is configured", async () => {
    ownedHash();
    list.mockResolvedValue({ blobs: [{ pathname: "push-sub/alice/h1.json" }], hasMore: false });
    const origGet = get.getMockImplementation()!;
    get.mockImplementation(async (p: string) => {
      if (p === "push-sub/alice/h1.json") {
        return { statusCode: 200, stream: streamOf({ endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } }) };
      }
      return origGet(p);
    });
    const r = await run("POST", authed(), {}, { shareHash: HASH }, VAPID_ENV, NOW);
    expect(r.status).toBe(200);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect((r.json as { push: { sent: number } }).push.sent).toBe(1);
  });

  it("still succeeds (release written) when the push send throws", async () => {
    ownedHash();
    list.mockResolvedValue({ blobs: [{ pathname: "push-sub/alice/h1.json" }], hasMore: false });
    const origGet = get.getMockImplementation()!;
    get.mockImplementation(async (p: string) => {
      if (p === "push-sub/alice/h1.json") {
        return { statusCode: 200, stream: streamOf({ endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } }) };
      }
      return origGet(p);
    });
    sendNotification.mockRejectedValueOnce(new Error("push service down"));
    const r = await run("POST", authed(), {}, { shareHash: HASH }, VAPID_ENV, NOW);
    expect(r.status).toBe(200);
    expect(put).toHaveBeenCalledWith(`release/${HASH}.json`, expect.any(String), expect.any(Object));
  });
});

describe("GET /api/release", () => {
  it("returns { releasedAt: null } when nothing was released", async () => {
    get.mockResolvedValue(null);
    const r = await run("GET", authed(), { shareHash: HASH }, undefined, ENV, NOW);
    expect(r).toEqual({ status: 200, json: { releasedAt: null } });
  });

  it("returns the stored marker", async () => {
    get.mockResolvedValue({ statusCode: 200, stream: streamOf({ releasedAt: "2026-09-09T01:00:00.000Z", by: "Prof. Kim" }) });
    const r = await run("GET", authed(), { shareHash: HASH }, undefined, ENV, NOW);
    expect(r.json).toEqual({ releasedAt: "2026-09-09T01:00:00.000Z", by: "Prof. Kim" });
  });

  it("rejects an unauthenticated GET", async () => {
    const r = await run("GET", {}, { shareHash: HASH }, undefined, ENV, NOW);
    expect(r.status).toBe(401);
  });
});
