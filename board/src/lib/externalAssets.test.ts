import { describe, expect, it, vi } from "vitest";
import { assetRefs, hydrateExternalAssets } from "./externalAssets";
import type { BoardData } from "./types";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function payload(): BoardData {
  return {
    mode: "submission",
    files: {
      manuscript: { path: "plans/manuscript.md", content: "", assets: { "fig.png": `aict-asset:${SHA_A}` } },
      executionPlans: [
        {
          component: "01-x",
          results: [{ assets: { "t.png": `aict-asset:${SHA_B}`, "small.csv": "data:text/csv;base64,YQ==" } }],
        },
      ],
    },
    externalAssets: {
      [SHA_A]: { mime: "image/png", size: 3, parts: 1 },
      [SHA_B]: { mime: "image/png", size: 6, parts: 2 },
    },
  } as unknown as BoardData;
}

describe("externalAssets", () => {
  it("finds references in the manuscript and bundle asset maps", () => {
    expect(assetRefs(payload()).sort()).toEqual([SHA_A, SHA_B]);
  });

  it("replaces references with object URLs, fetching every part, and leaves inline data alone", async () => {
    let n = 0;
    const spy = vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test/${++n}`);
    const fetchPart = vi.fn(async () => new ArrayBuffer(3));
    const original = payload();
    const out = await hydrateExternalAssets(original, "stu1", fetchPart);
    const files = (out as unknown as { files: any }).files;
    expect(files.manuscript.assets["fig.png"]).toMatch(/^blob:test\//);
    expect(files.executionPlans[0].results[0].assets["t.png"]).toMatch(/^blob:test\//);
    expect(files.executionPlans[0].results[0].assets["small.csv"]).toBe("data:text/csv;base64,YQ==");
    expect(fetchPart).toHaveBeenCalledTimes(3); // 1 part + 2 parts
    // the input payload is not mutated
    expect((original as unknown as { files: any }).files.manuscript.assets["fig.png"]).toBe(`aict-asset:${SHA_A}`);
    spy.mockRestore();
  });

  it("leaves a reference in place when its download fails", async () => {
    const out = await hydrateExternalAssets(payload(), "stu2", async () => {
      throw new Error("boom");
    });
    expect((out as unknown as { files: any }).files.manuscript.assets["fig.png"]).toBe(`aict-asset:${SHA_A}`);
  });
});
