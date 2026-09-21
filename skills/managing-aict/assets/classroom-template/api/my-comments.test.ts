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

import { run } from "./my-comments";
import { hashToken } from "../lib/roster";

const PEPPER = "pepper";
const ENV = { BLOB_READ_WRITE_TOKEN: "blob-tok", ROSTER_TOKEN_PEPPER: PEPPER };
const STUDENT_TOKEN = "alice-secret-token";
const STUDENT_TOKEN_HASH = hashToken(STUDENT_TOKEN, PEPPER);

function studentHeaders(token = STUDENT_TOKEN) {
  return { authorization: `Bearer ${token}` };
}

function mockAliceWithSubmissions(subs: { key: string; blobs: { pathname: string }[] }[]) {
  get.mockImplementation(async (pathname: string) => {
    if (pathname === `roster-token-index/${STUDENT_TOKEN_HASH}.json`) {
      return { statusCode: 200, stream: streamOf({ studentId: "alice" }) };
    }
    if (pathname === "roster/alice.json") {
      return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: STUDENT_TOKEN_HASH, createdAt: "x" }) };
    }
    for (const s of subs) {
      if (pathname === `submissions/alice/${s.key}.json`) {
        return { statusCode: 200, stream: streamOf({ studentId: "alice", submittedAt: "2026-08-01T00:00:00.000Z", idempotencyKey: s.key, reverify: [], payload: { files: {} } }) };
      }
    }
    return null;
  });
}

beforeEach(() => {
  put.mockClear();
  get.mockReset();
  list.mockReset();
});

describe("GET /api/my-comments", () => {
  it("rejects a request with no bearer token", async () => {
    const r = await run("GET", {}, ENV);
    expect(r).toEqual({ status: 401, json: { error: "invalid_token" } });
  });

  it("rejects an invalid bearer token", async () => {
    get.mockResolvedValue(null);
    const r = await run("GET", studentHeaders("garbage"), ENV);
    expect(r).toEqual({ status: 401, json: { error: "invalid_token" } });
  });

  it("rejects a non-GET method", async () => {
    const r = await run("POST", studentHeaders(), ENV);
    expect(r.status).toBe(405);
  });

  it("merges comments across every one of the student's own submissions, sorted by receivedAt", async () => {
    mockAliceWithSubmissions([
      { key: "share-a", blobs: [{ pathname: "comments/share-a/c1.json" }] },
      { key: "share-b", blobs: [{ pathname: "comments/share-b/c2.json" }] },
    ]);
    list.mockImplementation(async ({ prefix }: { prefix: string }) => {
      if (prefix === "submissions/alice/") {
        return { blobs: [{ pathname: "submissions/alice/share-a.json" }, { pathname: "submissions/alice/share-b.json" }], hasMore: false };
      }
      if (prefix === "comments/share-a/") {
        return { blobs: [{ pathname: "comments/share-a/c1.json" }], hasMore: false };
      }
      if (prefix === "comments/share-b/") {
        return { blobs: [{ pathname: "comments/share-b/c2.json" }], hasMore: false };
      }
      return { blobs: [], hasMore: false };
    });
    const origGet = get.getMockImplementation();
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "comments/share-a/c1.json") {
        return { statusCode: 200, stream: streamOf({ id: "c1", clientId: "x", author: "instructor", shareHash: "share-a", docHash: null, annotation: { comment: "later" }, receivedAt: "2026-08-10T00:00:00.000Z" }) };
      }
      if (pathname === "comments/share-b/c2.json") {
        return { statusCode: 200, stream: streamOf({ id: "c2", clientId: "x", author: "instructor", shareHash: "share-b", docHash: null, annotation: { comment: "earlier" }, receivedAt: "2026-08-05T00:00:00.000Z" }) };
      }
      return origGet ? origGet(pathname) : null;
    });

    const r = await run("GET", studentHeaders(), ENV);
    expect(r.status).toBe(200);
    const body = r.json as { studentId: string; comments: { id: string }[] };
    expect(body.studentId).toBe("alice");
    // earlier receivedAt first
    expect(body.comments.map((c) => c.id)).toEqual(["c2", "c1"]);
  });

  it("returns an empty list when the student has no submissions", async () => {
    mockAliceWithSubmissions([]);
    list.mockResolvedValue({ blobs: [], hasMore: false });
    const r = await run("GET", studentHeaders(), ENV);
    expect(r.status).toBe(200);
    expect((r.json as { comments: unknown[] }).comments).toEqual([]);
  });

  it("reports per-submission releasedAt (null until the instructor sends feedback)", async () => {
    mockAliceWithSubmissions([{ key: "share-a", blobs: [] }, { key: "share-b", blobs: [] }]);
    list.mockImplementation(async ({ prefix }: { prefix: string }) => {
      if (prefix === "submissions/alice/") {
        return { blobs: [{ pathname: "submissions/alice/share-a.json" }, { pathname: "submissions/alice/share-b.json" }], hasMore: false };
      }
      return { blobs: [], hasMore: false };
    });
    const origGet = get.getMockImplementation();
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "release/share-b.json") {
        return { statusCode: 200, stream: streamOf({ releasedAt: "2026-09-09T00:00:00.000Z", by: "Prof. Kim" }) };
      }
      return origGet ? origGet(pathname) : null;
    });
    const r = await run("GET", studentHeaders(), ENV);
    expect(r.status).toBe(200);
    const subs = (r.json as { submissions: { shareHash: string; releasedAt: string | null }[] }).submissions;
    expect(subs.find((s) => s.shareHash === "share-a")?.releasedAt).toBeNull();
    expect(subs.find((s) => s.shareHash === "share-b")?.releasedAt).toBe("2026-09-09T00:00:00.000Z");
  });
});
