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
    get.mockResolvedValue(null); // similarity cache miss
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
      return null; // no _latest.json pointer, no similarity cache
    });
    const r = await run("GET", authedHeaders(), undefined, ENV, NOW);
    const body = r.json as { students: Record<string, unknown>[] };
    expect(body.students.length).toBe(1);
    expect(body.students[0]).toMatchObject({ studentId: "alice", displayName: "Alice", lastSubmission: null, submissionCount: 0 });
  });

  it("surfaces the freshest results manifest's score/integrityStatus and each student's similarity flags", async () => {
    list.mockResolvedValueOnce({ blobs: [{ pathname: "roster/alice.json" }], hasMore: false }); // listRoster
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "roster/alice.json") {
        return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: "h", createdAt: "x" }) };
      }
      if (pathname === "similarity/latest.json") {
        return {
          statusCode: 200,
          stream: streamOf({
            checkedAt: "2026-08-20T00:00:00.000Z",
            flags: [{ studentA: "alice", studentB: "bob", artifact: "decision-log", jaccard: 0.5, sharedShingleCount: 3, sampleSharedPhrase: "x" }],
          }),
        };
      }
      if (pathname === "submissions/alice/_latest.json") {
        return { statusCode: 200, stream: streamOf({ idempotencyKey: "key1", submittedAt: "2026-08-19T00:00:00.000Z" }) };
      }
      if (pathname === "submissions/alice/key1.json") {
        return {
          statusCode: 200,
          stream: streamOf({
            studentId: "alice", submittedAt: "2026-08-19T00:00:00.000Z", idempotencyKey: "key1", reverify: [],
            payload: {
              files: {
                executionPlans: [
                  { component: "01-x", results: [{ manifest: { capturedAt: "2026-08-18 10:00", score: { profile: "F3·A3·I3" }, integrity: { status: "passed" } } }] },
                ],
              },
            },
          }),
        };
      }
      return null;
    });
    list.mockResolvedValueOnce({ blobs: [{ pathname: "submissions/alice/key1.json" }], hasMore: false }); // listSubmissionsForStudent

    const r = await run("GET", authedHeaders(), undefined, ENV, NOW);
    const body = r.json as { students: Record<string, unknown>[] };
    const row = body.students[0];
    expect((row.lastSubmission as Record<string, unknown>).score).toEqual({ profile: "F3·A3·I3" });
    expect((row.lastSubmission as Record<string, unknown>).integrityStatus).toBe("passed");
    expect(row.similarityFlags).toEqual([{ withStudentId: "bob", jaccard: 0.5, artifact: "decision-log" }]);
    expect(row.submissionCount).toBe(1);
  });

  it("flags a row isNewSinceLastView when its submission postdates the instructor's last visit, and clears on the next visit", async () => {
    // Anchored to the real wall clock (not the fictional NOW second-count
    // used elsewhere) because setLastViewed/getLastViewed compare real
    // `new Date().toISOString()` values, not the `now` epoch-seconds param.
    const submittedAt = new Date(Date.now() - 3600_000).toISOString(); // 1 hour ago
    list.mockImplementation(async (opts: { prefix: string }) => {
      if (opts.prefix === "roster/") return { blobs: [{ pathname: "roster/alice.json" }], hasMore: false };
      if (opts.prefix === "submissions/alice/") return { blobs: [{ pathname: "submissions/alice/key1.json" }], hasMore: false };
      return { blobs: [], hasMore: false };
    });
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "roster/alice.json") {
        return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: "h", createdAt: "x" }) };
      }
      if (pathname === "roster-meta/last-viewed.json") return null; // never viewed yet
      if (pathname === "submissions/alice/_latest.json") {
        return { statusCode: 200, stream: streamOf({ idempotencyKey: "key1", submittedAt }) };
      }
      if (pathname === "submissions/alice/key1.json") {
        return { statusCode: 200, stream: streamOf({ studentId: "alice", submittedAt, idempotencyKey: "key1", reverify: [], payload: { files: { executionPlans: [] } } }) };
      }
      return null;
    });

    const first = await run("GET", authedHeaders(), undefined, ENV, NOW);
    const firstRow = (first.json as { students: Record<string, unknown>[] }).students[0];
    expect(firstRow.isNewSinceLastView).toBe(true);

    // The last-viewed pointer must have been advanced to "now" for next time.
    const pointerWrite = put.mock.calls.find((c) => c[0] === "roster-meta/last-viewed.json");
    expect(pointerWrite).toBeTruthy();
    const writtenTimestamp = (JSON.parse(pointerWrite![1] as string) as { timestamp: string }).timestamp;

    // A second visit, with the pointer now set to after the submission, sees it as no longer new.
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "roster/alice.json") {
        return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: "h", createdAt: "x" }) };
      }
      if (pathname === "roster-meta/last-viewed.json") return { statusCode: 200, stream: streamOf({ timestamp: writtenTimestamp }) };
      if (pathname === "submissions/alice/_latest.json") {
        return { statusCode: 200, stream: streamOf({ idempotencyKey: "key1", submittedAt }) };
      }
      if (pathname === "submissions/alice/key1.json") {
        return { statusCode: 200, stream: streamOf({ studentId: "alice", submittedAt, idempotencyKey: "key1", reverify: [], payload: { files: { executionPlans: [] } } }) };
      }
      return null;
    });
    const second = await run("GET", authedHeaders(), undefined, ENV, NOW + 10);
    const secondRow = (second.json as { students: Record<string, unknown>[] }).students[0];
    expect(secondRow.isNewSinceLastView).toBe(false);
  });

  it("compares submittedAt and lastViewed as instants, not raw strings — a non-UTC offset must not misorder them", async () => {
    // submit.py's submittedAt carries the STUDENT's local UTC offset (e.g.
    // datetime.now().astimezone().isoformat()), never normalized to 'Z'.
    // "2026-08-25T01:00:00+09:00" is 2026-08-24T16:00:00Z — chronologically
    // BEFORE "2026-08-24T17:00:00.000Z" — even though it sorts AFTER it as a
    // bare string (the date digit '5' > '4'). A correct implementation must
    // read this submission as NOT new; a lexical-string-comparison bug reads
    // it as new. This regression-tests exactly the shape submit.py produces.
    const submittedAtLocalOffset = "2026-08-25T01:00:00+09:00"; // == 2026-08-24T16:00:00.000Z
    const lastViewedUtc = "2026-08-24T17:00:00.000Z"; // later in real time
    list.mockImplementation(async (opts: { prefix: string }) => {
      if (opts.prefix === "roster/") return { blobs: [{ pathname: "roster/alice.json" }], hasMore: false };
      return { blobs: [], hasMore: false };
    });
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "roster/alice.json") {
        return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: "h", createdAt: "x" }) };
      }
      if (pathname === "roster-meta/last-viewed.json") return { statusCode: 200, stream: streamOf({ timestamp: lastViewedUtc }) };
      if (pathname === "submissions/alice/_latest.json") {
        return { statusCode: 200, stream: streamOf({ idempotencyKey: "key1", submittedAt: submittedAtLocalOffset }) };
      }
      if (pathname === "submissions/alice/key1.json") {
        return { statusCode: 200, stream: streamOf({ studentId: "alice", submittedAt: submittedAtLocalOffset, idempotencyKey: "key1", reverify: [], payload: { files: { executionPlans: [] } } }) };
      }
      return null;
    });
    const r = await run("GET", authedHeaders(), undefined, ENV, NOW);
    const row = (r.json as { students: Record<string, unknown>[] }).students[0];
    expect(row.isNewSinceLastView).toBe(false);
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
