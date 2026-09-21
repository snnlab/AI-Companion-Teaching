import { describe, it, expect, vi, beforeEach } from "vitest";

function streamOf(obj: unknown): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}

const { put, get } = vi.hoisted(() => ({
  put: vi.fn(async (_pathname: string, _body: string, _options?: Record<string, unknown>) => ({})),
  get: vi.fn(),
}));
vi.mock("@vercel/blob", () => ({ put, get }));

import { getRelease, putRelease } from "./release";

const HASH = "a1b2c3d4e5f60718";

beforeEach(() => { put.mockClear(); get.mockReset(); });

describe("release markers", () => {
  it("getRelease returns null when no marker exists", async () => {
    get.mockResolvedValue(null);
    expect(await getRelease("tok", HASH)).toBeNull();
  });

  it("getRelease parses a stored marker", async () => {
    get.mockResolvedValue({ statusCode: 200, stream: streamOf({ releasedAt: "2026-09-09T01:00:00.000Z", by: "Prof. Kim" }) });
    expect(await getRelease("tok", HASH)).toEqual({ releasedAt: "2026-09-09T01:00:00.000Z", by: "Prof. Kim" });
  });

  it("putRelease writes an overwritable marker at release/<hash>.json and returns it", async () => {
    const when = new Date("2026-09-09T02:30:00.000Z");
    const marker = await putRelease("tok", HASH, "Prof. Kim", when);
    expect(marker).toEqual({ releasedAt: "2026-09-09T02:30:00.000Z", by: "Prof. Kim" });
    expect(put).toHaveBeenCalledTimes(1);
    const [pathname, bodyStr, opts] = put.mock.calls[0];
    expect(pathname).toBe(`release/${HASH}.json`);
    expect(JSON.parse(bodyStr as string)).toEqual(marker);
    expect((opts as Record<string, unknown>).allowOverwrite).toBe(true);
  });

  it("putRelease normalizes a missing author to null", async () => {
    const marker = await putRelease("tok", HASH, null, new Date("2026-09-09T00:00:00.000Z"));
    expect(marker.by).toBeNull();
  });
});
