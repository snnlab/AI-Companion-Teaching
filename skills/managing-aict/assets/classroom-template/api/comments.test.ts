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

import { run } from "./comments";
import { signCookie } from "../lib/auth";
import { hashToken } from "../lib/roster";

const SECRET = "instructor-secret";
const NOW = 1_000_000;
const PEPPER = "pepper";
const ENV = { BLOB_READ_WRITE_TOKEN: "blob-tok", ROSTER_TOKEN_PEPPER: PEPPER, BOARD_SESSION_SECRET: SECRET };
const SHARE_HASH = "cae78817221bfe49";
const STUDENT_TOKEN = "alice-secret-token";
const STUDENT_TOKEN_HASH = hashToken(STUDENT_TOKEN, PEPPER);

function instructorHeaders() {
  const cookie = signCookie(SECRET, NOW, 3600);
  return { cookie: `instructor_session=${cookie}` };
}
function studentHeaders(token = STUDENT_TOKEN) {
  return { authorization: `Bearer ${token}` };
}

function goodCommentBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    clientId: "client-1",
    author: "instructor",
    shareHash: SHARE_HASH,
    docHash: null,
    annotation: { type: "general", comment: "worth a second look" },
    ...overrides,
  };
}

function mockOwnedShareHash(studentId = "alice") {
  get.mockImplementation(async (pathname: string) => {
    if (pathname === `submission-index/${SHARE_HASH}.json`) {
      return { statusCode: 200, stream: streamOf({ studentId }) };
    }
    if (pathname === `roster-token-index/${STUDENT_TOKEN_HASH}.json`) {
      return { statusCode: 200, stream: streamOf({ studentId: "alice" }) };
    }
    if (pathname === "roster/alice.json") {
      return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: STUDENT_TOKEN_HASH, createdAt: "x" }) };
    }
    return null;
  });
}

beforeEach(() => {
  put.mockReset();
  put.mockImplementation(async () => ({}));
  get.mockReset();
  list.mockReset();
});

describe("GET /api/comments", () => {
  it("requires a shareHash query parameter", async () => {
    const r = await run("GET", instructorHeaders(), {}, undefined, ENV, NOW);
    expect(r).toEqual({ status: 400, json: { error: "shareHash query parameter is required" } });
  });

  it("rejects a request with neither an instructor session nor a bearer token", async () => {
    const r = await run("GET", {}, { shareHash: SHARE_HASH }, undefined, ENV, NOW);
    expect(r).toEqual({ status: 401, json: { error: "unauthorized" } });
  });

  it("lets the instructor read any student's comments", async () => {
    list.mockResolvedValue({ blobs: [], hasMore: false });
    const r = await run("GET", instructorHeaders(), { shareHash: SHARE_HASH }, undefined, ENV, NOW);
    expect(r.status).toBe(200);
    expect((r.json as { comments: unknown[] }).comments).toEqual([]);
  });

  it("lets a student read comments on their OWN shareHash via bearer token", async () => {
    mockOwnedShareHash("alice");
    list.mockResolvedValue({ blobs: [], hasMore: false });
    const r = await run("GET", studentHeaders(), { shareHash: SHARE_HASH }, undefined, ENV, NOW);
    expect(r.status).toBe(200);
  });

  it("refuses a student reading comments on a shareHash that resolves to a DIFFERENT student", async () => {
    mockOwnedShareHash("bob"); // the shareHash belongs to bob, not alice (the bearer token's owner)
    const r = await run("GET", studentHeaders(), { shareHash: SHARE_HASH }, undefined, ENV, NOW);
    expect(r).toEqual({ status: 403, json: { error: "forbidden" } });
  });

  it("rejects an invalid bearer token", async () => {
    get.mockResolvedValue(null);
    const r = await run("GET", studentHeaders("garbage"), { shareHash: SHARE_HASH }, undefined, ENV, NOW);
    expect(r).toEqual({ status: 401, json: { error: "invalid_token" } });
  });
});

describe("POST /api/comments", () => {
  it("rejects a request without an instructor session", async () => {
    const r1 = await run("POST", {}, {}, goodCommentBody(), ENV, NOW);
    expect(r1).toEqual({ status: 401, json: { error: "unauthorized" } });
    // A student's own bearer token must never be able to post — only the
    // instructor's browser session ever reaches this branch.
    const r2 = await run("POST", studentHeaders(), {}, goodCommentBody(), ENV, NOW);
    expect(r2).toEqual({ status: 401, json: { error: "unauthorized" } });
  });

  it("rejects an invalid comment body", async () => {
    const r = await run("POST", instructorHeaders(), {}, { ...goodCommentBody(), id: "not-a-uuid" }, ENV, NOW);
    expect(r.status).toBe(400);
    expect((r.json as Record<string, unknown>).error).toBe("invalid");
  });

  it("rejects a shareHash that does not correspond to any known submission", async () => {
    get.mockResolvedValue(null); // submission-index lookup misses
    const r = await run("POST", instructorHeaders(), {}, goodCommentBody(), ENV, NOW);
    expect(r).toEqual({ status: 400, json: { error: "unknown shareHash" } });
  });

  it("accepts a well-formed comment on a known shareHash", async () => {
    get.mockImplementation(async (pathname: string) => {
      if (pathname === `submission-index/${SHARE_HASH}.json`) {
        return { statusCode: 200, stream: streamOf({ studentId: "alice" }) };
      }
      return null; // no existing comment with this id
    });
    const r = await run("POST", instructorHeaders(), {}, goodCommentBody(), ENV, NOW);
    expect(r.status).toBe(200);
    expect((r.json as { ok: boolean }).ok).toBe(true);
    expect(put).toHaveBeenCalledTimes(1);
    const [pathname] = put.mock.calls[0];
    expect(pathname).toBe(`comments/${SHARE_HASH}/11111111-1111-4111-8111-111111111111.json`);
  });

  it("rejects an unsupported method with 405", async () => {
    const r = await run("DELETE", instructorHeaders(), {}, undefined, ENV, NOW);
    expect(r.status).toBe(405);
  });
});
