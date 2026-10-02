import { describe, it, expect, vi, beforeEach } from "vitest";

function streamOf(obj: unknown): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}

const { put, get, list } = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), list: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put, get, list }));

import { run } from "./mySubmission";
import { hashToken } from "./roster";

const PEPPER = "pepper";
const ENV = { BLOB_READ_WRITE_TOKEN: "blob-tok", ROSTER_TOKEN_PEPPER: PEPPER };
const TOKEN = "alice-secret-token";
const HASH = hashToken(TOKEN, PEPPER);
const KEY = "cae78817221bfe49";
const BOB_KEY = "0123456789abcdef";
const bearer = (t = TOKEN) => ({ authorization: `Bearer ${t}` });

let released: Set<string>;

beforeEach(() => {
  released = new Set([KEY, BOB_KEY]);
  get.mockReset().mockImplementation(async (p: string) => {
    if (p === `roster-token-index/${HASH}.json`) return { statusCode: 200, stream: streamOf({ studentId: "alice" }) };
    if (p === "roster/alice.json") {
      return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: HASH, createdAt: "x" }) };
    }
    if (p === `submissions/alice/${KEY}.json`) {
      return { statusCode: 200, stream: streamOf({ studentId: "alice", submittedAt: "2026-09-29T23:40:00+09:00", idempotencyKey: KEY, payload: { files: { manuscript: { content: "x" } } } }) };
    }
    if (p === `submissions/bob/${BOB_KEY}.json`) {
      return { statusCode: 200, stream: streamOf({ studentId: "bob", submittedAt: "x", idempotencyKey: BOB_KEY, payload: {} }) };
    }
    const m = /^release\/(.+)\.json$/.exec(p);
    if (m && released.has(m[1])) return { statusCode: 200, stream: streamOf({ releasedAt: "2026-10-01T00:00:00.000Z", by: "K" }) };
    return null;
  });
});

describe("GET /api/my-submission", () => {
  it("returns the student's own released submission", async () => {
    const r = await run("GET", bearer(), KEY, ENV);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      studentId: "alice", idempotencyKey: KEY, releasedAt: "2026-10-01T00:00:00.000Z",
      payload: { files: { manuscript: { content: "x" } } },
    });
  });

  it("refuses an unreleased submission (403) and never serves another student's (404)", async () => {
    released.delete(KEY);
    expect((await run("GET", bearer(), KEY, ENV)).json).toEqual({ error: "not_released" });
    expect((await run("GET", bearer(), BOB_KEY, ENV)).status).toBe(404);
  });

  it("rejects a missing or unknown token, a bad key, and non-GET", async () => {
    expect((await run("GET", {}, KEY, ENV)).status).toBe(401);
    expect((await run("GET", bearer("nope"), KEY, ENV)).status).toBe(401);
    expect((await run("GET", bearer(), "../../roster/alice", ENV)).status).toBe(400);
    expect((await run("GET", bearer(), null, ENV)).status).toBe(400);
    expect((await run("POST", bearer(), KEY, ENV)).status).toBe(405);
  });
});
