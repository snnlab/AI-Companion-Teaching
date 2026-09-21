import { describe, it, expect } from "vitest";
import {
  coerceModelUsage,
  parsePlanModelMarker,
  stripPlanMarkerLine,
  modelChipText,
} from "./modelUsage";

describe("coerceModelUsage", () => {
  it("accepts a well-formed usage", () => {
    expect(coerceModelUsage({ model: "opus", effort: "max" }))
      .toEqual({ model: "opus", effort: "max" });
    expect(coerceModelUsage({ model: "sonnet" }))
      .toEqual({ model: "sonnet", effort: null });
  });

  // Bundles finalized before the simplification are immutable, so their
  // {prescribed, reported} shape has to keep reading forever.
  it("reads the legacy two-sided shape, preferring what actually ran", () => {
    expect(coerceModelUsage({
      prescribed: { model: "opus", effort: "max" },
      reported: { model: "sonnet", effort: null },
    })).toEqual({ model: "sonnet", effort: null });
  });
  it("falls back to the prescribed side when nothing was reported", () => {
    expect(coerceModelUsage({ prescribed: { model: "opus", effort: null }, reported: null }))
      .toEqual({ model: "opus", effort: null });
  });

  it("returns null when nothing usable", () => {
    expect(coerceModelUsage({})).toBeNull();
    expect(coerceModelUsage(null)).toBeNull();
    expect(coerceModelUsage({ effort: "max" })).toBeNull(); // no model
    expect(coerceModelUsage({ prescribed: { effort: "max" } })).toBeNull();
    expect(coerceModelUsage("nope")).toBeNull();
  });
});

describe("parsePlanModelMarker", () => {
  const usage = { model: "opus", effort: "max" };
  it("extracts and strips a valid marker", () => {
    const content = `<!-- aict-model ${JSON.stringify(usage)} -->\n# Plan v1\n\nBody.`;
    const p = parsePlanModelMarker(content);
    expect(p.modelUsage).toEqual(usage);
    expect(p.malformed).toBe(false);
    expect(p.body).toBe("# Plan v1\n\nBody.");
  });
  it("leaves a plain document untouched", () => {
    const p = parsePlanModelMarker("# Plan v1\n\nBody.");
    expect(p.modelUsage).toBeNull();
    expect(p.body).toBe("# Plan v1\n\nBody.");
  });
  it("strips a malformed marker line so it can never hide the body", () => {
    const p = parsePlanModelMarker("<!-- aict-model {broken \n# Plan v1\n");
    expect(p.malformed).toBe(true);
    expect(p.modelUsage).toBeNull();
    expect(p.body).toBe("# Plan v1\n");
    expect(stripPlanMarkerLine("<!-- aict-model {broken \nX\n")).toBe("X\n");
  });
});

describe("modelChipText", () => {
  it("formats model and effort", () => {
    expect(modelChipText({ model: "opus", effort: "max" })).toBe("opus·max");
    expect(modelChipText({ model: "sonnet", effort: null })).toBe("sonnet");
  });
  it("prefixes a label when given", () => {
    expect(modelChipText({ model: "opus", effort: null }, "captured by"))
      .toBe("captured by opus");
  });
  it("returns null without a model", () => {
    expect(modelChipText({ model: "", effort: null })).toBeNull();
  });
});
