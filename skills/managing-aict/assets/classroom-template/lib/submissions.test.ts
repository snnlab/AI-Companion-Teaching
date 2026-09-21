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

import { putSubmission, advanceLatestPointer, getLatestPointer, listSubmissionsForStudent, indexShareHashOwner, resolveShareHashOwner, type StoredSubmission } from "./submissions";

const TOKEN = "tok-blob";

beforeEach(() => {
  put.mockReset();
  put.mockImplementation(async () => ({}));
  get.mockReset();
  list.mockReset();
});

function submission(overrides: Partial<StoredSubmission> = {}): StoredSubmission {
  return {
    studentId: "alice",
    envelopeSchemaVersion: 1,
    submittedAt: "2026-08-10T10:00:00.000Z",
    courseId: "soc-501",
    idempotencyKey: "0123456789abcdef",
    payload: { files: {} },
    gitExcerpt: { available: false, head: null, branch: null, commits: [] },
    serverReceivedAt: "2026-08-10T10:00:01.000Z",
    reverify: [],
    ...overrides,
  };
}

describe("putSubmission", () => {
  it("creates a new submission with create-only semantics", async () => {
    get.mockResolvedValue(null);
    const s = submission();
    const result = await putSubmission(TOKEN, "alice", s.idempotencyKey, s);
    expect(result.outcome).toBe("created");
    expect(put).toHaveBeenCalledTimes(1);
    const [pathname, , options] = put.mock.calls[0];
    expect(pathname).toBe(`submissions/alice/${s.idempotencyKey}.json`);
    expect(options).toMatchObject({ access: "private", allowOverwrite: false, token: TOKEN });
  });

  it("treats an identical resend as a replay, returning the PREVIOUSLY stored reverify", async () => {
    const original = submission({ reverify: [{ check: "x", status: "match", detail: "first" }] });
    get.mockResolvedValue({ statusCode: 200, stream: streamOf(original) });
    const resend = submission({
      reverify: [{ check: "x", status: "match", detail: "recomputed-but-should-be-ignored" }],
      serverReceivedAt: "2026-08-10T11:00:00.000Z", // different — must not affect the comparison
    });
    const result = await putSubmission(TOKEN, "alice", original.idempotencyKey, resend);
    expect(result.outcome).toBe("replay");
    expect(result.stored.reverify).toEqual(original.reverify);
    expect(put).not.toHaveBeenCalled();
  });

  it("replays a plain resend of unchanged work — only send-context differs", async () => {
    const original = submission({
      payload: { schemaVersion: 2, generatedAt: "2026-08-20T10:00:00+09:00", files: { masterPlan: { path: "plans/master-plan.md", content: "X" } } },
    });
    get.mockResolvedValue({ statusCode: 200, stream: streamOf(original) });
    const resend = submission({
      submittedAt: "2026-08-25T09:30:00.000Z",
      gitExcerpt: { available: true, head: "abc123", branch: "main", commits: [
        { hash: "abc123", authorDate: "2026-08-24", author: "Alice", subject: "unrelated commit" },
      ] },
      payload: { schemaVersion: 2, generatedAt: "2026-08-25T09:30:00+09:00", git: { head: "abc123" }, files: { masterPlan: { path: "plans/master-plan.md", content: "X" } } },
    });
    const result = await putSubmission(TOKEN, "alice", original.idempotencyKey, resend);
    expect(result.outcome).toBe("replay");
    expect(put).not.toHaveBeenCalled();
  });

  it("flags a conflict when the same key carries different graded files", async () => {
    const original = submission({ payload: { files: { masterPlan: { path: "plans/master-plan.md", content: "ORIGINAL" } } } });
    get.mockResolvedValue({ statusCode: 200, stream: streamOf(original) });
    const differentFiles = submission({ payload: { files: { masterPlan: { path: "plans/master-plan.md", content: "TAMPERED" } } } });
    expect((await putSubmission(TOKEN, "alice", original.idempotencyKey, differentFiles)).outcome).toBe("conflict");
    expect(put).not.toHaveBeenCalled();
  });

  it("flags a conflict when the same key+files carry a different courseId", async () => {
    const files = { masterPlan: { path: "plans/master-plan.md", content: "ORIGINAL" } };
    const original = submission({ courseId: "soc-501", payload: { files } });
    get.mockResolvedValue({ statusCode: 200, stream: streamOf(original) });
    const differentCourse = submission({ courseId: "other-course", payload: { files } });
    expect((await putSubmission(TOKEN, "alice", original.idempotencyKey, differentCourse)).outcome).toBe("conflict");
    expect(put).not.toHaveBeenCalled();
  });

  it("resolves a concurrent identical create race as one create + one replay", async () => {
    let stored: StoredSubmission | null = null;
    get.mockImplementation(async () => (stored ? { statusCode: 200, stream: streamOf(stored) } : null));
    put.mockImplementation(async (_p: string, body: string) => {
      if (stored) throw new Error("already exists");
      stored = JSON.parse(body) as StoredSubmission;
      return {};
    });
    const s = submission();
    const results = await Promise.all([
      putSubmission(TOKEN, "alice", s.idempotencyKey, s),
      putSubmission(TOKEN, "alice", s.idempotencyKey, { ...s, serverReceivedAt: "later" }),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["created", "replay"]);
  });
});

describe("advanceLatestPointer / getLatestPointer", () => {
  it("writes and reads the pointer as overwritable", async () => {
    await advanceLatestPointer(TOKEN, "alice", { idempotencyKey: "abc", submittedAt: "2026-08-10T10:00:00.000Z" });
    expect(put).toHaveBeenCalledWith(
      "submissions/alice/_latest.json",
      JSON.stringify({ idempotencyKey: "abc", submittedAt: "2026-08-10T10:00:00.000Z" }),
      expect.objectContaining({ allowOverwrite: true }),
    );
    get.mockResolvedValue({ statusCode: 200, stream: streamOf({ idempotencyKey: "abc", submittedAt: "2026-08-10T10:00:00.000Z" }) });
    expect(await getLatestPointer(TOKEN, "alice")).toEqual({ idempotencyKey: "abc", submittedAt: "2026-08-10T10:00:00.000Z" });
  });
});

describe("indexShareHashOwner / resolveShareHashOwner", () => {
  it("writes an overwritable index entry and resolves it back", async () => {
    await indexShareHashOwner(TOKEN, "cae78817221bfe49", "alice");
    expect(put).toHaveBeenCalledWith(
      "submission-index/cae78817221bfe49.json",
      JSON.stringify({ studentId: "alice" }),
      expect.objectContaining({ allowOverwrite: true }),
    );
    get.mockResolvedValue({ statusCode: 200, stream: streamOf({ studentId: "alice" }) });
    expect(await resolveShareHashOwner(TOKEN, "cae78817221bfe49")).toBe("alice");
  });

  it("returns null for an unknown shareHash", async () => {
    get.mockResolvedValue(null);
    expect(await resolveShareHashOwner(TOKEN, "unknown")).toBeNull();
  });
});

describe("listSubmissionsForStudent", () => {
  it("excludes the _latest.json pointer and sorts newest-first", async () => {
    list.mockResolvedValue({
      blobs: [
        { pathname: "submissions/alice/_latest.json" },
        { pathname: "submissions/alice/aaa.json" },
        { pathname: "submissions/alice/bbb.json" },
      ],
      hasMore: false,
    });
    get.mockImplementation(async (pathname: string) => {
      if (pathname === "submissions/alice/aaa.json") {
        return { statusCode: 200, stream: streamOf(submission({ idempotencyKey: "aaa", submittedAt: "2026-08-01T00:00:00.000Z" })) };
      }
      if (pathname === "submissions/alice/bbb.json") {
        return { statusCode: 200, stream: streamOf(submission({ idempotencyKey: "bbb", submittedAt: "2026-08-05T00:00:00.000Z" })) };
      }
      throw new Error(`unexpected get(${pathname})`);
    });
    const subs = await listSubmissionsForStudent(TOKEN, "alice");
    expect(subs.map((s) => s.idempotencyKey)).toEqual(["bbb", "aaa"]);
  });
});
