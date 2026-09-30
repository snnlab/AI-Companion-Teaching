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

const ALICE = { studentId: "alice", displayName: "Alice", tokenHash: "h", createdAt: "x" };

beforeEach(() => {
  put.mockClear();
  get.mockReset();
  list.mockReset();
});

describe("GET /api/submissions/:studentId", () => {
  it("rejects an unauthenticated request", async () => {
    const r = await run("GET", {}, "alice", null, ENV, NOW);
    expect(r).toEqual({ status: 401, json: { error: "unauthorized" } });
  });

  it("returns 404 for an unknown student", async () => {
    get.mockResolvedValue(null);
    const r = await run("GET", authedHeaders(), "ghost", null, ENV, NOW);
    expect(r).toEqual({ status: 404, json: { error: "not_found" } });
  });

  it("lists submissions newest-first from the index, without any payload", async () => {
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "roster/alice.json") return { statusCode: 200, stream: streamOf(ALICE) };
      if (pathname === "submissions/alice/_index.json") {
        return {
          statusCode: 200,
          stream: streamOf([
            { idempotencyKey: "bbbbbbbbbbbbbbbb", submittedAt: "2026-08-10T00:00:00.000Z" },
            { idempotencyKey: "aaaaaaaaaaaaaaaa", submittedAt: "2026-08-01T00:00:00.000Z" },
          ]),
        };
      }
      return null;
    });

    const r = await run("GET", authedHeaders(), "alice", null, ENV, NOW);
    expect(r.status).toBe(200);
    const body = r.json as { displayName: string; submissions: Record<string, unknown>[] };
    expect(body.displayName).toBe("Alice");
    expect(body.submissions.map((s) => s.idempotencyKey)).toEqual(["bbbbbbbbbbbbbbbb", "aaaaaaaaaaaaaaaa"]);
    expect(body.submissions.every((s) => !("payload" in s))).toBe(true);
    expect(list).not.toHaveBeenCalled();
  });

  it("returns one submission in full for ?key=", async () => {
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "roster/alice.json") return { statusCode: 200, stream: streamOf(ALICE) };
      if (pathname === "submissions/alice/aaaaaaaaaaaaaaaa.json") {
        return {
          statusCode: 200,
          stream: streamOf({
            studentId: "alice", submittedAt: "2026-08-01T00:00:00.000Z", idempotencyKey: "aaaaaaaaaaaaaaaa",
            reverify: [], payload: { files: {} },
          }),
        };
      }
      return null;
    });
    const r = await run("GET", authedHeaders(), "alice", "aaaaaaaaaaaaaaaa", ENV, NOW);
    expect(r).toEqual({
      status: 200,
      json: { submittedAt: "2026-08-01T00:00:00.000Z", idempotencyKey: "aaaaaaaaaaaaaaaa", payload: { files: {} } },
    });
  });

  it("rejects a malformed key and 404s a missing one", async () => {
    get.mockImplementation(async (pathname: string) =>
      pathname === "roster/alice.json" ? { statusCode: 200, stream: streamOf(ALICE) } : null);
    expect((await run("GET", authedHeaders(), "alice", "../x", ENV, NOW)).status).toBe(400);
    expect((await run("GET", authedHeaders(), "alice", "cccccccccccccccc", ENV, NOW)).status).toBe(404);
  });

  it("rejects a non-GET method", async () => {
    get.mockResolvedValue({ statusCode: 200, stream: streamOf({}) }); // isAuthed passes
    const r = await run("POST", authedHeaders(), "alice", null, ENV, NOW);
    expect(r.status).toBe(405);
  });
});
