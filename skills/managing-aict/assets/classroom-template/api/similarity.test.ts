import { describe, it, expect, vi, beforeEach } from "vitest";

function streamOf(obj: unknown): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}

const { put, get, list } = vi.hoisted(() => ({
  put: vi.fn(async (_pathname: string, _body: string, _options?: Record<string, unknown>) => ({})),
  get: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@vercel/blob", () => ({ put, get, list }));

import { run } from "./similarity";
import { signCookie } from "../lib/auth";

const SECRET = "instructor-secret";
const NOW = 1_000_000;
const ENV = { BLOB_READ_WRITE_TOKEN: "blob-tok", BOARD_SESSION_SECRET: SECRET };

function authedHeaders() {
  return { cookie: `instructor_session=${signCookie(SECRET, NOW, 3600)}` };
}

beforeEach(() => {
  put.mockClear();
  get.mockReset();
  list.mockReset();
});

describe("similarity endpoint", () => {
  it("rejects an unauthenticated request on both GET and POST", async () => {
    expect(await run("GET", {}, ENV, NOW)).toEqual({ status: 401, json: { error: "unauthorized" } });
    expect(await run("POST", {}, ENV, NOW)).toEqual({ status: 401, json: { error: "unauthorized" } });
  });

  it("GET returns an empty result when nothing has been cached yet", async () => {
    get.mockResolvedValue(null);
    const r = await run("GET", authedHeaders(), ENV, NOW);
    expect(r).toEqual({ status: 200, json: { checkedAt: null, flags: [] } });
  });

  it("GET returns the cached result without recomputing (no roster/list calls)", async () => {
    get.mockResolvedValue({ statusCode: 200, stream: streamOf({ checkedAt: "2026-08-20T00:00:00.000Z", flags: [] }) });
    const r = await run("GET", authedHeaders(), ENV, NOW);
    expect(r.status).toBe(200);
    expect(list).not.toHaveBeenCalled();
  });

  it("POST computes flags across every student's latest submission and caches the result", async () => {
    list.mockResolvedValue({
      blobs: [{ pathname: "roster/alice.json" }, { pathname: "roster/bob.json" }],
      hasMore: false,
    });
    const shared = "we decided to drop missing income cases listwise after checking the covariate balance table";
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "roster/alice.json") return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: "h", createdAt: "x" }) };
      if (pathname === "roster/bob.json") return { statusCode: 200, stream: streamOf({ studentId: "bob", displayName: "Bob", tokenHash: "h", createdAt: "x" }) };
      if (pathname === "submissions/alice/_latest.json") return { statusCode: 200, stream: streamOf({ idempotencyKey: "a1", submittedAt: "x" }) };
      if (pathname === "submissions/bob/_latest.json") return { statusCode: 200, stream: streamOf({ idempotencyKey: "b1", submittedAt: "x" }) };
      if (pathname === "submissions/alice/a1.json") {
        return { statusCode: 200, stream: streamOf({ payload: { files: { decisionLog: { content: shared } } } }) };
      }
      if (pathname === "submissions/bob/b1.json") {
        return { statusCode: 200, stream: streamOf({ payload: { files: { decisionLog: { content: shared } } } }) };
      }
      return null;
    });

    const r = await run("POST", authedHeaders(), ENV, NOW);
    expect(r.status).toBe(200);
    const body = r.json as { checkedAt: string; flags: { studentA: string; studentB: string }[] };
    expect(body.flags.length).toBe(1);
    expect([body.flags[0].studentA, body.flags[0].studentB].sort()).toEqual(["alice", "bob"]);

    const cacheWrite = put.mock.calls.find((c) => c[0] === "similarity/latest.json");
    expect(cacheWrite).toBeTruthy();
  });

  it("rejects other methods", async () => {
    const r = await run("DELETE", authedHeaders(), ENV, NOW);
    expect(r.status).toBe(405);
  });
});
