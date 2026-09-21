import { describe, it, expect } from "vitest";
import { validateEnvelopeShape, validateEnvelopeSize, MAX_ENVELOPE_BYTES } from "./validate";

function goodEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    envelopeSchemaVersion: 1,
    submittedAt: "2026-08-20T10:00:00-04:00",
    courseId: "soc-501",
    idempotencyKey: "0123456789abcdef",
    payload: { files: {} },
    gitExcerpt: {
      available: true,
      head: "abc1234",
      branch: "main",
      commits: [
        { hash: "abc1234", authorDate: "2026-08-18T09:00:00-04:00", authorName: "A Student", subject: "plans: v1" },
      ],
    },
    ...overrides,
  };
}

describe("validateEnvelopeSize", () => {
  it("accepts a small body", () => {
    expect(validateEnvelopeSize("{}").ok).toBe(true);
  });
  it("rejects a body over MAX_ENVELOPE_BYTES with the exact limit echoed back", () => {
    const big = "x".repeat(MAX_ENVELOPE_BYTES + 1);
    const r = validateEnvelopeSize(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.limitBytes).toBe(MAX_ENVELOPE_BYTES);
  });
  it("counts UTF-8 bytes, not JS string length", () => {
    // Each 😀 is 1 UTF-16 code unit pair (length 2) but 4 UTF-8 bytes.
    const nearLimitChars = Math.floor(MAX_ENVELOPE_BYTES / 4) + 10;
    const big = "😀".repeat(nearLimitChars);
    expect(validateEnvelopeSize(big).ok).toBe(false);
  });
});

describe("validateEnvelopeShape", () => {
  it("accepts a well-formed envelope", () => {
    const r = validateEnvelopeShape(goodEnvelope());
    expect(r.ok).toBe(true);
  });
  it("accepts a null courseId", () => {
    expect(validateEnvelopeShape(goodEnvelope({ courseId: null })).ok).toBe(true);
  });
  it("rejects a non-object body", () => {
    expect(validateEnvelopeShape(null).ok).toBe(false);
    expect(validateEnvelopeShape("x").ok).toBe(false);
    expect(validateEnvelopeShape([]).ok).toBe(false);
  });
  it("rejects an unsupported envelopeSchemaVersion", () => {
    expect(validateEnvelopeShape(goodEnvelope({ envelopeSchemaVersion: 2 })).ok).toBe(false);
  });
  it("rejects a bad submittedAt", () => {
    expect(validateEnvelopeShape(goodEnvelope({ submittedAt: "not-a-date" })).ok).toBe(false);
  });
  it("rejects a malformed idempotencyKey", () => {
    expect(validateEnvelopeShape(goodEnvelope({ idempotencyKey: "too-short" })).ok).toBe(false);
    expect(validateEnvelopeShape(goodEnvelope({ idempotencyKey: "0123456789ABCDEF" })).ok).toBe(false); // uppercase rejected
  });
  it("rejects a non-object payload", () => {
    expect(validateEnvelopeShape(goodEnvelope({ payload: "nope" })).ok).toBe(false);
    expect(validateEnvelopeShape(goodEnvelope({ payload: [] })).ok).toBe(false);
  });
  it("rejects a malformed gitExcerpt", () => {
    expect(validateEnvelopeShape(goodEnvelope({ gitExcerpt: null })).ok).toBe(false);
    expect(validateEnvelopeShape(goodEnvelope({ gitExcerpt: { available: "yes", head: null, branch: null, commits: [] } })).ok).toBe(false);
  });
  it("accepts gitExcerpt.available=false with an empty commit list", () => {
    const r = validateEnvelopeShape(goodEnvelope({ gitExcerpt: { available: false, head: null, branch: null, commits: [] } }));
    expect(r.ok).toBe(true);
  });
  it("rejects a commit entry missing required fields", () => {
    const bad = goodEnvelope({
      gitExcerpt: { available: true, head: "a", branch: "main", commits: [{ hash: "a" }] },
    });
    expect(validateEnvelopeShape(bad).ok).toBe(false);
  });
  it("accepts an optional per-commit files array, forward-compatibly", () => {
    const withFiles = goodEnvelope({
      gitExcerpt: {
        available: true, head: "a", branch: "main",
        commits: [{ hash: "a", authorDate: "2026-08-18T09:00:00-04:00", authorName: "A", subject: "s", files: ["plans/execution/01-x/v1.md"] }],
      },
    });
    expect(validateEnvelopeShape(withFiles).ok).toBe(true);
  });
  it("rejects a non-string-array files field", () => {
    const bad = goodEnvelope({
      gitExcerpt: {
        available: true, head: "a", branch: "main",
        commits: [{ hash: "a", authorDate: "2026-08-18T09:00:00-04:00", authorName: "A", subject: "s", files: [1, 2] }],
      },
    });
    expect(validateEnvelopeShape(bad).ok).toBe(false);
  });
});
