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

import { run } from "./[studentId]";
import { signCookie } from "../../lib/auth";

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

describe("GET /api/submissions/:studentId", () => {
  it("rejects an unauthenticated request", async () => {
    const r = await run("GET", {}, "alice", ENV, NOW);
    expect(r).toEqual({ status: 401, json: { error: "unauthorized" } });
  });

  it("returns 404 for an unknown student", async () => {
    get.mockResolvedValue(null);
    const r = await run("GET", authedHeaders(), "ghost", ENV, NOW);
    expect(r).toEqual({ status: 404, json: { error: "not_found" } });
  });

  it("returns the full submission history newest-first, each with the full stored payload", async () => {
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "roster/alice.json") {
        return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: "h", createdAt: "x" }) };
      }
      if (pathname === "submissions/alice/old.json") {
        return {
          statusCode: 200,
          stream: streamOf({
            studentId: "alice", submittedAt: "2026-08-01T00:00:00.000Z", idempotencyKey: "old",
            reverify: [{ check: "x", status: "match", detail: "d" }], payload: { files: {} },
          }),
        };
      }
      if (pathname === "submissions/alice/new.json") {
        return {
          statusCode: 200,
          stream: streamOf({
            studentId: "alice", submittedAt: "2026-08-10T00:00:00.000Z", idempotencyKey: "new",
            reverify: [], payload: { files: {} },
          }),
        };
      }
      return null;
    });
    list.mockResolvedValue({
      blobs: [{ pathname: "submissions/alice/old.json" }, { pathname: "submissions/alice/new.json" }],
      hasMore: false,
    });

    const r = await run("GET", authedHeaders(), "alice", ENV, NOW);
    expect(r.status).toBe(200);
    const body = r.json as { displayName: string; submissions: { idempotencyKey: string; payload: unknown }[] };
    expect(body.displayName).toBe("Alice");
    expect(body.submissions.map((s) => s.idempotencyKey)).toEqual(["new", "old"]);
    expect(body.submissions[0].payload).toEqual({ files: {} });
  });

  it("rejects a non-GET method", async () => {
    get.mockResolvedValue({ statusCode: 200, stream: streamOf({}) }); // isAuthed passes
    const r = await run("POST", authedHeaders(), "alice", ENV, NOW);
    expect(r.status).toBe(405);
  });
});
