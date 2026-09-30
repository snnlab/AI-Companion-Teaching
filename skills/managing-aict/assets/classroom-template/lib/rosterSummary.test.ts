import { describe, it, expect, vi, beforeEach } from "vitest";

const { put, get, del } = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn(async () => ({})) }));
vi.mock("@vercel/blob", () => ({ put, get, del }));

import { updateSummary, SUMMARY_PATH } from "./rosterSummary";

function stored(students: Record<string, unknown>, etag: string) {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, students }));
  return { statusCode: 200, stream: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), blob: { etag } };
}

beforeEach(() => {
  put.mockReset();
  get.mockReset();
  del.mockClear();
});

describe("updateSummary", () => {
  it("does nothing when no summary exists yet (the next roster load builds a complete one)", async () => {
    get.mockResolvedValue(null);
    await updateSummary("t", () => true);
    expect(put).not.toHaveBeenCalled();
  });

  it("retries on a concurrent change and applies the mutation to the fresh copy", async () => {
    let n = 0;
    get.mockImplementation(async () => (++n === 1 ? stored({ a: 1 }, "e1") : stored({ a: 1, b: 2 }, "e2")));
    put.mockImplementationOnce(async () => { throw new Error("precondition failed"); }).mockResolvedValue({});
    await updateSummary("t", (s) => { (s.students as Record<string, unknown>).c = 3; return true; });
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1][2]).toMatchObject({ ifMatch: "e2" });
    expect(Object.keys(JSON.parse(put.mock.calls[1][1] as string).students)).toEqual(["a", "b", "c"]);
    expect(get.mock.calls.every((c) => (c[1] as { useCache?: boolean }).useCache === false)).toBe(true);
  });

  it("drops the summary for a rebuild when the mutation cannot apply, or writes keep failing", async () => {
    get.mockResolvedValue(null);
    get.mockImplementation(async () => stored({}, "e1"));
    await updateSummary("t", () => false);
    expect(del).toHaveBeenCalledWith(SUMMARY_PATH, expect.anything());

    del.mockClear();
    put.mockRejectedValue(new Error("precondition failed"));
    await updateSummary("t", () => true);
    expect(del).toHaveBeenCalledWith(SUMMARY_PATH, expect.anything());
  });
});
