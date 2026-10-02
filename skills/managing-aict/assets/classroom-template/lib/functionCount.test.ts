// Vercel's Hobby plan refuses a deployment with more than 12 Serverless
// Functions (exceeded_serverless_functions_per_deployment) — and counts more
// than the api/ files alone (v0.13.0 shipped exactly 12 api functions and was
// refused). docs/hosting-the-roster.md promises the Hobby plan is enough, so
// keep headroom: fold a new route into an existing function and add a
// vercel.json rewrite (see /api/logout, /api/vapid-public-key,
// /api/my-submission) rather than adding a file under api/.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_API_FUNCTIONS = 10;

function apiFunctions(dir: string, rel = "api"): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? apiFunctions(join(dir, e.name), `${rel}/${e.name}`)
      : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [`${rel}/${e.name}`] : [],
  );
}

describe("deployment size on the Hobby plan", () => {
  const functions = apiFunctions(join(ROOT, "api"));

  it(`has at most ${MAX_API_FUNCTIONS} api functions`, () => {
    expect(functions.length, functions.join(", ")).toBeLessThanOrEqual(MAX_API_FUNCTIONS);
  });

  it("rewrites every folded route to a function that exists", () => {
    const { rewrites } = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
      rewrites: { source: string; destination: string }[];
    };
    const folded = rewrites.filter((r) => r.source.startsWith("/api/"));
    expect(folded.map((r) => r.source).sort()).toEqual(["/api/logout", "/api/my-submission", "/api/vapid-public-key"]);
    for (const r of folded) {
      expect(functions).toContain(`${r.destination.split("?")[0].slice(1)}.ts`);
      expect(functions).not.toContain(`${r.source.slice(1)}.ts`);
    }
  });
});
