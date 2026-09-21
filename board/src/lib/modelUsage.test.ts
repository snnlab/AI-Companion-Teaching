import { describe, it, expect } from "vitest";
import {
  coerceModelUsage,
  modelsEquivalent,
  parsePlanModelMarker,
  stripPlanMarkerLine,
  modelChipText,
} from "./modelUsage";

describe("coerceModelUsage", () => {
  it("accepts a well-formed usage", () => {
    const u = coerceModelUsage({ prescribed: { model: "opus", effort: "max" }, reported: { model: "sonnet", effort: null } });
    expect(u).toEqual({ prescribed: { model: "opus", effort: "max" }, reported: { model: "sonnet", effort: null } });
  });
  it("keeps one side when the other is missing", () => {
    expect(coerceModelUsage({ prescribed: { model: "opus", effort: null } })).toEqual({
      prescribed: { model: "opus", effort: null }, reported: null,
    });
  });
  it("returns null when nothing usable", () => {
    expect(coerceModelUsage({})).toBeNull();
    expect(coerceModelUsage(null)).toBeNull();
    expect(coerceModelUsage({ prescribed: { effort: "max" } })).toBeNull(); // no model
    expect(coerceModelUsage("nope")).toBeNull();
  });
});

describe("modelsEquivalent", () => {
  it("matches identical and alias/full-id pairs", () => {
    expect(modelsEquivalent("opus", "opus")).toBe(true);
    expect(modelsEquivalent("opus", "claude-opus-4-8")).toBe(true);
    expect(modelsEquivalent("claude-sonnet-5", "sonnet")).toBe(true);
  });
  it("distinguishes different models and treats inherit as no prescription", () => {
    expect(modelsEquivalent("opus", "sonnet")).toBe(false);
    expect(modelsEquivalent("inherit", "opus")).toBe(false);
    expect(modelsEquivalent("claude-opus-4-8", "claude-sonnet-5")).toBe(false);
  });
});

describe("parsePlanModelMarker", () => {
  const usage = { prescribed: { model: "opus", effort: "max" }, reported: { model: "opus", effort: null } };
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
  it("shows prescribed only when reported agrees or is absent", () => {
    expect(modelChipText({ prescribed: { model: "opus", effort: "max" }, reported: null }))
      .toEqual({ main: "opus·max", sub: "" });
    expect(modelChipText({ prescribed: { model: "opus", effort: "medium" }, reported: { model: "claude-opus-4-8", effort: null } }))
      .toEqual({ main: "opus·medium", sub: "" }); // alias-equivalent → no override note
  });
  it("appends the reported override when it differs", () => {
    expect(modelChipText({ prescribed: { model: "opus", effort: "max" }, reported: { model: "sonnet", effort: null } }))
      .toEqual({ main: "opus·max", sub: "reported sonnet" });
  });
  it("uses a custom reported label and reported-only form", () => {
    expect(modelChipText({ prescribed: null, reported: { model: "opus", effort: null } }, "captured by"))
      .toEqual({ main: "captured by opus", sub: "" });
  });
  it("returns null when empty", () => {
    expect(modelChipText({ prescribed: null, reported: null })).toBeNull();
  });
});
