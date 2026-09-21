import { describe, it, expect } from "vitest";
import { validateCommentBody, MAX_COMMENT_LEN, MAX_TOTAL_BYTES } from "./validate";

const good = {
  id: "11111111-1111-4111-8111-111111111111",
  clientId: "c-abc",
  author: "Ada",
  shareHash: "abc123",
  annotation: { type: "plan-comment", component: "01-x", version: 1,
                quote: "the sample", comment: "expand please" },
};

describe("validateCommentBody", () => {
  it("accepts a well-formed comment", () => {
    const r = validateCommentBody(good);
    expect(r.ok).toBe(true);
  });
  it("rejects a non-object / missing fields", () => {
    expect(validateCommentBody(null).ok).toBe(false);
    expect(validateCommentBody({ ...good, id: undefined }).ok).toBe(false);
    expect(validateCommentBody({ ...good, annotation: undefined }).ok).toBe(false);
  });
  it("rejects a disallowed annotation type", () => {
    expect(validateCommentBody({ ...good, annotation: { type: "verdict" } }).ok).toBe(false);
  });
  it("rejects an over-long comment", () => {
    const long = { ...good, annotation: { ...good.annotation, comment: "x".repeat(MAX_COMMENT_LEN + 1) } };
    expect(validateCommentBody(long).ok).toBe(false);
  });
  it("rejects a non-uuid id", () => {
    expect(validateCommentBody({ ...good, id: "not-a-uuid" }).ok).toBe(false);
  });
  it("accepts the well-formed comment well under the total-size cap", () => {
    expect(JSON.stringify(good).length).toBeLessThan(MAX_TOTAL_BYTES);
    expect(validateCommentBody(good).ok).toBe(true);
  });
  it("rejects a body whose annotation carries a huge extra field", () => {
    const oversized = {
      ...good,
      annotation: { ...good.annotation, junk: "x".repeat(MAX_TOTAL_BYTES) },
    };
    expect(validateCommentBody(oversized).ok).toBe(false);
  });
  it("rejects a multibyte body over the byte cap even when its string length is under", () => {
    const oversizedBytes = {
      ...good,
      annotation: { ...good.annotation, junk: "😀".repeat(20_000) },
    };
    const serialized = JSON.stringify(oversizedBytes);
    expect(serialized.length).toBeLessThan(MAX_TOTAL_BYTES);
    expect(Buffer.byteLength(serialized, "utf8")).toBeGreaterThan(MAX_TOTAL_BYTES);
    expect(validateCommentBody(oversizedBytes).ok).toBe(false);
  });
  it("accepts a near-maximal legitimate comment (not false-rejected by the size cap)", () => {
    const maximal = {
      id: "11111111-1111-4111-8111-111111111111",
      clientId: "c".repeat(200),
      author: "A".repeat(120),
      shareHash: "h".repeat(200),
      docHash: "d".repeat(200),
      annotation: {
        type: "plan-comment",
        component: "C".repeat(2000),
        version: 1,
        sectionHeading: "S".repeat(2000),
        quote: "Q".repeat(2000),
        excerpt: "E".repeat(2000),
        script: "X".repeat(2000),
        comment: "M".repeat(4000),
        // Extra fields (unvalidated per-field, but pass overall validation)
        reason: "R".repeat(1000),
        context: "K".repeat(1000),
      },
    };
    // sanity: this legitimate payload exceeds the OLD 16000 cap
    expect(JSON.stringify(maximal).length).toBeGreaterThan(16000);
    expect(validateCommentBody(maximal).ok).toBe(true);
  });
});
