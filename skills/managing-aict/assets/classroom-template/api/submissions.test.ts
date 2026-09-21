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

import { run } from "./submissions";
import { hashToken } from "../lib/roster";
import { MAX_ENVELOPE_BYTES } from "../lib/validate";

const ENV = { BLOB_READ_WRITE_TOKEN: "blob-tok", ROSTER_TOKEN_PEPPER: "pepper" };
const STUDENT_TOKEN = "alice-secret-token";
const STUDENT_TOKEN_HASH = hashToken(STUDENT_TOKEN, ENV.ROSTER_TOKEN_PEPPER);

function goodEnvelope(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    envelopeSchemaVersion: 1,
    submittedAt: "2026-08-20T10:00:00-04:00",
    courseId: "soc-501",
    idempotencyKey: "0123456789abcdef",
    payload: { files: { executionPlans: [], decisionLog: { content: "" }, reviews: [] } },
    gitExcerpt: { available: false, head: null, branch: null, commits: [] },
    ...overrides,
  });
}

function mockRosterAndSubmissionStore() {
  const submissions = new Map<string, unknown>();
  get.mockImplementation(async (pathname: string) => {
    if (pathname === `roster-token-index/${STUDENT_TOKEN_HASH}.json`) {
      return { statusCode: 200, stream: streamOf({ studentId: "alice" }) };
    }
    if (pathname === "roster/alice.json") {
      return { statusCode: 200, stream: streamOf({ studentId: "alice", displayName: "Alice", tokenHash: STUDENT_TOKEN_HASH, createdAt: "x" }) };
    }
    if (submissions.has(pathname)) {
      return { statusCode: 200, stream: streamOf(submissions.get(pathname)) };
    }
    return null;
  });
  put.mockImplementation(async (pathname: string, body: string) => {
    if (submissions.has(pathname)) throw new Error("already exists");
    submissions.set(pathname, JSON.parse(body));
    return {};
  });
  return submissions;
}

beforeEach(() => {
  put.mockClear();
  get.mockReset();
  list.mockReset();
  del.mockClear();
});

describe("POST /api/submissions", () => {
  it("rejects a missing/invalid bearer token with 401 invalid_token", async () => {
    const r1 = await run("POST", {}, goodEnvelope(), ENV);
    expect(r1).toEqual({ status: 401, json: { error: "invalid_token" } });

    get.mockResolvedValue(null);
    const r2 = await run("POST", { authorization: "Bearer nope" }, goodEnvelope(), ENV);
    expect(r2).toEqual({ status: 401, json: { error: "invalid_token" } });
  });

  it("rejects an oversized body with 413 payload_too_large and the exact limitBytes", async () => {
    const big = goodEnvelope({ padding: "x".repeat(MAX_ENVELOPE_BYTES) });
    const r = await run("POST", { authorization: `Bearer ${STUDENT_TOKEN}` }, big, ENV);
    expect(r).toEqual({ status: 413, json: { error: "payload_too_large", limitBytes: MAX_ENVELOPE_BYTES } });
  });

  it("rejects malformed JSON with 400 malformed_envelope", async () => {
    mockRosterAndSubmissionStore();
    const r = await run("POST", { authorization: `Bearer ${STUDENT_TOKEN}` }, "{not json", ENV);
    expect(r.status).toBe(400);
    expect((r.json as Record<string, unknown>).error).toBe("malformed_envelope");
  });

  it("rejects a structurally invalid envelope with 400 malformed_envelope", async () => {
    mockRosterAndSubmissionStore();
    const r = await run("POST", { authorization: `Bearer ${STUDENT_TOKEN}` }, JSON.stringify({ envelopeSchemaVersion: 2 }), ENV);
    expect(r.status).toBe(400);
    expect((r.json as Record<string, unknown>).error).toBe("malformed_envelope");
  });

  it("accepts a well-formed envelope: 201 created with a reverify array, and advances the latest pointer", async () => {
    mockRosterAndSubmissionStore();
    const r = await run("POST", { authorization: `Bearer ${STUDENT_TOKEN}` }, goodEnvelope(), ENV);
    expect(r.status).toBe(201);
    const body = r.json as Record<string, unknown>;
    expect(body.status).toBe("created");
    expect(body.submissionId).toBe("0123456789abcdef");
    expect(Array.isArray(body.reverify)).toBe(true);

    const pointerCall = put.mock.calls.find((c) => c[0] === "submissions/alice/_latest.json");
    expect(pointerCall).toBeTruthy();
  });

  it("replays an identical resubmission as 200 with the PREVIOUSLY computed reverify, and does not re-advance the pointer", async () => {
    mockRosterAndSubmissionStore();
    const first = await run("POST", { authorization: `Bearer ${STUDENT_TOKEN}` }, goodEnvelope(), ENV);
    expect(first.status).toBe(201);
    put.mockClear(); // isolate the second call's puts

    const second = await run("POST", { authorization: `Bearer ${STUDENT_TOKEN}` }, goodEnvelope(), ENV);
    expect(second.status).toBe(200);
    const body = second.json as Record<string, unknown>;
    expect(body.status).toBe("replay");
    expect(body.reverify).toEqual((first.json as Record<string, unknown>).reverify);
    // No new content blob AND no pointer advance on replay.
    expect(put).not.toHaveBeenCalled();
  });

  it("stores-and-flags rather than rejecting a submission with content-level integrity issues", async () => {
    mockRosterAndSubmissionStore();
    const envelope = goodEnvelope({
      payload: {
        files: {
          decisionLog: { content: "" },
          reviews: [],
          executionPlans: [
            {
              component: "01-x",
              versions: [{ version: 1, path: "plans/execution/01-x/v1.md", content: "# Plan\n\nSigned off: A, 2026-08-01\n" }],
              results: [
                {
                  resultsVersion: 1,
                  assets: {},
                  manifest: {
                    capturedAt: "2026-08-05 10:00",
                    artifacts: [{ id: "a1", file: "artifacts/missing.png", source: { sha256: "deadbeef" } }],
                    metrics: [],
                    integrity: { status: "passed", checks: [{ name: "checksums", verdict: "pass" }] },
                  },
                },
              ],
            },
          ],
        },
      },
    });
    const r = await run("POST", { authorization: `Bearer ${STUDENT_TOKEN}` }, envelope, ENV);
    expect(r.status).toBe(201); // never rejected for a content-level mismatch
    const body = r.json as { reverify: { check: string; status: string }[] };
    const integrityCheck = body.reverify.find((c) => c.check === "integrity:01-x r1");
    expect(integrityCheck?.status).toBe("mismatch"); // recomputed "failed" vs sealed "passed"
  });

  it("rejects a GET with 405", async () => {
    const r = await run("GET", {}, "{}", ENV);
    expect(r.status).toBe(405);
  });
});
