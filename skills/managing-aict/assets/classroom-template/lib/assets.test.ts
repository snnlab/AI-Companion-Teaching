import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const store = new Map<string, Buffer>();
const { put, get, head } = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), head: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put, get, head }));

import { verifyAsset, parseExternalAssets, collectAssetRefs, ASSET_PART_BYTES } from "./assets";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

beforeEach(() => {
  store.clear();
  put.mockReset().mockImplementation(async (p: string, body: Buffer | string) => { store.set(p, Buffer.from(body)); return {}; });
  head.mockReset().mockImplementation(async (p: string) => { if (!store.has(p)) throw new Error("nf"); return {}; });
  get.mockReset().mockImplementation(async (p: string) => {
    const b = store.get(p);
    return b ? { statusCode: 200, stream: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(b)); c.close(); } }) } : null;
  });
});

describe("verifyAsset", () => {
  it("verifies a multi-part file's whole hash once, then trusts the marker", async () => {
    const a = Buffer.from("part-a"), b = Buffer.from("part-b");
    const whole = sha(Buffer.concat([a, b]));
    store.set(`assets/s1/${whole}/0`, a);
    store.set(`assets/s1/${whole}/1`, b);
    expect(await verifyAsset("t", "s1", whole, 2)).toBe(true);
    expect(store.has(`assets/s1/${whole}/verified`)).toBe(true);
    get.mockClear();
    expect(await verifyAsset("t", "s1", whole, 2)).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects parts that do not add up to the declared hash, and leaves no marker", async () => {
    const whole = sha(Buffer.from("something-else"));
    store.set(`assets/s1/${whole}/0`, Buffer.from("x"));
    store.set(`assets/s1/${whole}/1`, Buffer.from("y"));
    expect(await verifyAsset("t", "s1", whole, 2)).toBe(false);
    expect(store.has(`assets/s1/${whole}/verified`)).toBe(false);
  });
});

describe("parseExternalAssets / collectAssetRefs", () => {
  it("accepts a consistent declaration and rejects a part count that does not match the size", () => {
    const s = "c".repeat(64);
    expect(parseExternalAssets({ [s]: { mime: "image/png", size: 10, parts: 1 } }).ok).toBe(true);
    expect(parseExternalAssets({ [s]: { mime: "image/png", size: ASSET_PART_BYTES + 1, parts: 1 } }).ok).toBe(false);
    expect(parseExternalAssets({ nothex: { mime: "image/png", size: 1, parts: 1 } }).ok).toBe(false);
    expect(parseExternalAssets(undefined)).toEqual({ ok: true, value: {} });
  });

  it("finds references in the manuscript and bundle maps only", () => {
    const s1 = "d".repeat(64), s2 = "e".repeat(64);
    const refs = collectAssetRefs({
      files: {
        manuscript: { assets: { "f.png": `aict-asset:${s1}` } },
        executionPlans: [{ results: [{ assets: { "t.png": `aict-asset:${s2}`, "x.csv": "data:text/csv;base64,YQ==" } }] }],
      },
    });
    expect(refs.sort()).toEqual([s1, s2]);
  });
});
