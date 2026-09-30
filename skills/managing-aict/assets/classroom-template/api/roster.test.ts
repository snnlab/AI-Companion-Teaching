import { describe, it, expect, vi, beforeEach } from "vitest";

function streamOf(obj: unknown): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}

const { put, get, list, del } = vi.hoisted(() => ({
  put: vi.fn(async (_pathname: string, _body: string, _options?: Record<string, unknown>) => ({})),
  get: vi.fn(),
  list: vi.fn(),
  del: vi.fn(async (_pathname: string, _options?: Record<string, unknown>) => ({})),
}));
vi.mock("@vercel/blob", () => ({ put, get, list, del }));

import { run } from "./roster";
import { signCookie } from "../lib/auth";

const SECRET = "instructor-secret";
const NOW = 1_000_000;
const ENV = { BLOB_READ_WRITE_TOKEN: "blob-tok", ROSTER_TOKEN_PEPPER: "pepper", BOARD_SESSION_SECRET: SECRET };

function authedHeaders() {
  const cookie = signCookie(SECRET, NOW, 3600);
  return { cookie: `instructor_session=${cookie}` };
}

beforeEach(() => {
  put.mockClear();
  get.mockReset();
  list.mockReset();
  del.mockClear();
});

describe("GET /api/roster", () => {
  it("rejects an unauthenticated request", async () => {
    const r = await run("GET", {}, undefined, ENV, NOW);
    expect(r).toEqual({ status: 401, json: { error: "unauthorized" } });
  });

  it("returns an empty roster when no students are registered", async () => {
    list.mockResolvedValue({ blobs: [], hasMore: false });
    get.mockResolvedValue(null);
    const r = await run("GET", authedHeaders(), undefined, ENV, NOW);
    expect(r.status).toBe(200);
    const body = r.json as Record<string, unknown>;
    expect(body.schemaVersion).toBe(1);
    expect(body.students).toEqual([]);
  });

  it("carries course.instructorName from COURSE_INSTRUCTOR_NAME (null when unset)", async () => {
    list.mockResolvedValue({ blobs: [], hasMore: false });
    get.mockResolvedValue(null);
    const bare = (await run("GET", authedHeaders(), undefined, ENV, NOW)).json as { course: Record<string, unknown> };
    expect(bare.course.instructorName).toBeNull();
    const named = (await run("GET", authedHeaders(), undefined, { ...ENV, COURSE_INSTRUCTOR_NAME: "Prof. Kim" }, NOW))
      .json as { course: Record<string, unknown> };
    expect(named.course.instructorName).toBe("Prof. Kim");
  });

  it("builds a roster row with lastSubmission null when a student has never submitted", async () => {
    list.mockImplementation(async (opts: { prefix: string }) => {
      if (opts.prefix === "roster/") return { blobs: [{ pathname: "roster/alice.json" }], hasMore: false };
      return { blobs: [], hasMore: false }; // no submissions for this student
    });
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "roster/alice.json") {
        return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: "h", createdAt: "x" }) };
      }
      return null; // no _latest.json pointer
    });
    const r = await run("GET", authedHeaders(), undefined, ENV, NOW);
    const body = r.json as { students: Record<string, unknown>[] };
    expect(body.students.length).toBe(1);
    expect(body.students[0]).toMatchObject({ studentId: "alice", displayName: "Alice", lastSubmission: null, submissionCount: 0 });
  });

  it("answers from the roster summary alone when it exists — nothing per student", async () => {
    list.mockResolvedValue({ blobs: [], hasMore: false });
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "roster-meta/summary.json") {
        return {
          statusCode: 200,
          stream: streamOf({
            version: 1,
            students: {
              alice: { displayName: "Alice", lastSubmission: { submittedAt: "2026-08-19T00:00:00.000Z", idempotencyKey: "key1" }, submissionCount: 3 },
              bob: { displayName: "Bob", lastSubmission: null, submissionCount: 0 },
            },
          }),
          blob: { etag: "e1" },
        };
      }
      return null;
    });

    const r = await run("GET", authedHeaders(), undefined, ENV, NOW);
    const rows = (r.json as { students: Record<string, unknown>[] }).students;
    expect(rows.map((x) => x.displayName)).toEqual(["Alice", "Bob"]);
    expect(rows[0]).toMatchObject({ studentId: "alice", submissionCount: 3, lastSubmission: { idempotencyKey: "key1" } });
    expect(list).not.toHaveBeenCalled();
    expect(get.mock.calls.map((c) => c[0])).toEqual(["roster-meta/summary.json"]);
  });

  it("registering a student adds them to an existing summary with a conditional write", async () => {
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "roster-meta/summary.json") {
        return { statusCode: 200, stream: streamOf({ version: 1, students: {} }), blob: { etag: "e1" } };
      }
      return null;
    });
    await run("POST", authedHeaders(), { studentId: "carol", displayName: "Carol" }, ENV, NOW);
    const w = put.mock.calls.find((c) => c[0] === "roster-meta/summary.json");
    expect(w![2]).toMatchObject({ ifMatch: "e1" });
    expect(JSON.parse(w![1] as string).students.carol).toEqual({ displayName: "Carol", lastSubmission: null, submissionCount: 0, viewedAt: null });
  });

  it("counts a pre-index student's submissions once and writes the index back", async () => {
    list.mockImplementation(async (opts: { prefix: string }) => {
      if (opts.prefix === "roster/") return { blobs: [{ pathname: "roster/alice.json" }], hasMore: false };
      if (opts.prefix === "submissions/alice/") {
        return {
          blobs: [
            { pathname: "submissions/alice/key1.json" },
            { pathname: "submissions/alice/key2.json" },
            { pathname: "submissions/alice/_latest.json" },
          ],
          hasMore: false,
        };
      }
      return { blobs: [], hasMore: false };
    });
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "roster/alice.json") {
        return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: "h", createdAt: "x" }) };
      }
      if (pathname === "submissions/alice/_latest.json") {
        return { statusCode: 200, stream: streamOf({ idempotencyKey: "key2", submittedAt: "2026-08-20T00:00:00.000Z" }) };
      }
      const m = pathname.match(/^submissions\/alice\/(key\d)\.json$/);
      if (m) {
        const at = m[1] === "key1" ? "2026-08-19T00:00:00.000Z" : "2026-08-20T00:00:00.000Z";
        return { statusCode: 200, stream: streamOf({ studentId: "alice", submittedAt: at, idempotencyKey: m[1], reverify: [], payload: {} }) };
      }
      return null; // no _index.json yet
    });

    const r = await run("GET", authedHeaders(), undefined, ENV, NOW);
    const row = (r.json as { students: Record<string, unknown>[] }).students[0];
    expect(row.submissionCount).toBe(2);
    const indexWrite = put.mock.calls.find((c) => c[0] === "submissions/alice/_index.json");
    expect(JSON.parse(indexWrite![1] as string).map((m: { idempotencyKey: string }) => m.idempotencyKey)).toEqual(["key2", "key1"]);
  });

  it("marks a row new when its latest submission is later than the last time that student's board was opened", async () => {
    list.mockResolvedValue({ blobs: [], hasMore: false });
    const sub = (at: string) => ({ submittedAt: at, idempotencyKey: "k" });
    get.mockImplementation(async (pathname: string) => {
      if (pathname !== "roster-meta/summary.json") return null;
      return {
        statusCode: 200,
        blob: { etag: "e" },
        stream: streamOf({
          version: 1,
          students: {
            // opened before the latest submission -> new
            alice: { displayName: "Alice", lastSubmission: sub("2026-08-20T10:00:00.000Z"), submissionCount: 2, viewedAt: "2026-08-19T00:00:00.000Z" },
            // opened after it -> not new
            bob: { displayName: "Bob", lastSubmission: sub("2026-08-20T10:00:00.000Z"), submissionCount: 1, viewedAt: "2026-08-21T00:00:00.000Z" },
            // never opened -> new
            carol: { displayName: "Carol", lastSubmission: sub("2026-08-20T10:00:00.000Z"), submissionCount: 1 },
            // never submitted -> never new
            dan: { displayName: "Dan", lastSubmission: null, submissionCount: 0 },
            // +09:00 offset: 2026-08-25T01:00+09:00 == 2026-08-24T16:00Z, BEFORE the 17:00Z open
            erin: { displayName: "Erin", lastSubmission: sub("2026-08-25T01:00:00+09:00"), submissionCount: 1, viewedAt: "2026-08-24T17:00:00.000Z" },
          },
        }),
      };
    });
    const r = await run("GET", authedHeaders(), undefined, ENV, NOW);
    const byId = Object.fromEntries(
      (r.json as { students: Record<string, unknown>[] }).students.map((x) => [x.studentId, x.isNewSinceLastView]),
    );
    expect(byId).toEqual({ alice: true, bob: false, carol: true, dan: false, erin: false });
    // Loading the dashboard no longer writes anything.
    expect(put).not.toHaveBeenCalled();
  });

  it("seeds each student's opened time from the legacy dashboard-visit pointer when rebuilding", async () => {
    list.mockImplementation(async (opts: { prefix: string }) =>
      opts.prefix === "roster/" ? { blobs: [{ pathname: "roster/alice.json" }], hasMore: false } : { blobs: [], hasMore: false });
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "roster/alice.json") {
        return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: "h", createdAt: "x" }) };
      }
      if (pathname === "roster-meta/last-viewed.json") return { statusCode: 200, stream: streamOf({ timestamp: "2026-08-01T00:00:00.000Z" }) };
      return null;
    });
    await run("GET", authedHeaders(), undefined, ENV, NOW);
    const w = put.mock.calls.find((c) => c[0] === "roster-meta/summary.json");
    expect(JSON.parse(w![1] as string).students.alice.viewedAt).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("POST /api/roster", () => {
  it("rejects an unauthenticated request", async () => {
    const r = await run("POST", {}, { studentId: "alice", displayName: "Alice" }, ENV, NOW);
    expect(r).toEqual({ status: 401, json: { error: "unauthorized" } });
  });

  it("rejects an invalid studentId or displayName", async () => {
    const r1 = await run("POST", authedHeaders(), { studentId: "bad id!", displayName: "Alice" }, ENV, NOW);
    expect(r1.status).toBe(400);
    const r2 = await run("POST", authedHeaders(), { studentId: "alice", displayName: "" }, ENV, NOW);
    expect(r2.status).toBe(400);
  });

  it("mints a token and returns it exactly once, never persisting it in plaintext", async () => {
    get.mockResolvedValue(null); // no existing student
    const r = await run("POST", authedHeaders(), { studentId: "alice", displayName: "Alice A." }, ENV, NOW);
    expect(r.status).toBe(200);
    const body = r.json as { studentId: string; displayName: string; token: string };
    expect(body.studentId).toBe("alice");
    expect(body.token.length).toBeGreaterThan(20);

    const rosterWrite = put.mock.calls.find((c) => c[0] === "roster/alice.json");
    expect(JSON.stringify(JSON.parse(rosterWrite![1] as string))).not.toContain(body.token);
  });
});
