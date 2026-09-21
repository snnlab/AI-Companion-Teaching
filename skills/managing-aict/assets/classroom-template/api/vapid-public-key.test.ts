import { describe, it, expect } from "vitest";
import { run } from "./vapid-public-key";

describe("GET /api/vapid-public-key", () => {
  it("returns the configured public key", () => {
    expect(run("GET", { VAPID_PUBLIC_KEY: "BPUBLIC" })).toEqual({ status: 200, json: { key: "BPUBLIC" } });
  });
  it("returns key: null when web push is not configured", () => {
    expect(run("GET", {})).toEqual({ status: 200, json: { key: null } });
  });
  it("rejects non-GET", () => {
    expect(run("POST", { VAPID_PUBLIC_KEY: "x" }).status).toBe(405);
  });
});
