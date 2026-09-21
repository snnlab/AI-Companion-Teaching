import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  parseTrailer,
  normalizePlan,
  computeIntegrity,
  reverifySubmission,
  findFreshestManifest,
} from "./reverify";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Shared-fixture test: parseTrailer here is a THIRD port of signoff_gate.py's
// parse_trailer (Python original -> board/src/lib/trailer.ts -> this file).
// This reads the SAME fixture directory board/src/lib/__fixtures__/trailer/
// that trailer.ts's own tests use, so all ports are checked against one
// shared table rather than three that could quietly drift apart.
//
// This is a plain node:fs read of files outside this package's directory,
// not a module import — Vitest test files run in Node and can read any path
// on disk, so there is no bundler-root boundary to cross here (unlike an
// `import` statement, which would need a tsconfig/bundler path mapping).
// The relative path below is classroom-template/lib -> classroom-template ->
// assets -> managing-aict -> skills -> repo root -> board/src/lib/....
// If this template is ever relocated, this is the path to update, and the
// test below fails loudly (skips with a clear message) rather than silently
// passing on zero fixtures if the directory can't be found.
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.resolve(__dirname, "../../../../../board/src/lib/__fixtures__/trailer");

describe("parseTrailer — shared fixture table (3rd port)", () => {
  const dirExists = existsSync(FIXTURE_DIR) && existsSync(path.join(FIXTURE_DIR, "expectations.json"));

  it("finds the shared fixture directory", () => {
    // If this fails, the relative path above needs updating (e.g. the
    // template moved) — see this file's top-of-block comment. Documented
    // per the task brief: attempt the shared-fixture approach first, and
    // note what happened if it can't be reached.
    expect(dirExists, `expected to find ${FIXTURE_DIR}`).toBe(true);
  });

  if (dirExists) {
    const expectations = JSON.parse(
      readFileSync(path.join(FIXTURE_DIR, "expectations.json"), "utf8"),
    ) as Record<string, { kind: string; violations: number }>;
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".md"));

    it("covers every fixture file listed in expectations.json", () => {
      const names = files.map((f) => f.replace(/\.md$/, ""));
      expect(names.sort()).toEqual(Object.keys(expectations).sort());
    });

    for (const file of files) {
      const name = file.replace(/\.md$/, "");
      const expected = expectations[name];
      it(`classifies ${name} as ${expected?.kind} with ${expected?.violations} violation(s)`, () => {
        const text = readFileSync(path.join(FIXTURE_DIR, file), "utf8");
        const result = parseTrailer(text);
        expect(result.kind).toBe(expected.kind);
        expect(result.violations.length).toBe(expected.violations);
      });
    }
  }
});

describe("parseTrailer — direct behavior", () => {
  it("classifies a well-formed signed trailer", () => {
    const r = parseTrailer("# Plan\n\nBody.\n\nSigned off: BK, 2026-07-18\n");
    expect(r.kind).toBe("signed");
    expect(r.line).toBe("Signed off: BK, 2026-07-18");
  });
  it("rejects an interior signature (reject-not-ignore)", () => {
    const r = parseTrailer("# Plan\n\nSigned off: BK, 2026-07-18\n\nOrdinary final line.\n");
    expect(r.kind).toBe("malformed");
    expect(r.violations.length).toBe(1);
  });
});

describe("normalizePlan", () => {
  it("strips a signed trailer and its preceding --- rule", () => {
    const signed = "# Plan\n\nBody.\n\n---\nSigned off: BK, 2026-07-18\n";
    const draft = "# Plan\n\nBody.\n";
    expect(normalizePlan(signed)).toBe(normalizePlan(draft));
  });
  it("is a no-op (modulo trailing newline) on text with no trailer", () => {
    expect(normalizePlan("hello\nworld")).toBe("hello\nworld\n");
  });
});

// ---------------------------------------------------------------------------
// Check 1: integrity recompute (ported results.py compute_integrity).
// ---------------------------------------------------------------------------

function dataUri(bytes: Buffer): string {
  return `data:application/octet-stream;base64,${bytes.toString("base64")}`;
}

describe("computeIntegrity", () => {
  it("passes all four checks for a clean bundle", () => {
    const bytes = Buffer.from("hello artifact");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const manifest = {
      artifacts: [{ id: "a1", file: "artifacts/foo.txt", source: { sha256 } }],
      metrics: [{ label: "m1", status: "robust", artifactIds: ["a1"] }],
    };
    const result = computeIntegrity(manifest, { "foo.txt": dataUri(bytes) });
    expect(result.status).toBe("passed");
    expect(result.checks.every((c) => c.verdict === "pass")).toBe(true);
  });

  it("fails checksums when the recomputed hash disagrees", () => {
    const bytes = Buffer.from("hello artifact");
    const manifest = {
      artifacts: [{ id: "a1", file: "artifacts/foo.txt", source: { sha256: "deadbeef" } }],
      metrics: [],
    };
    const result = computeIntegrity(manifest, { "foo.txt": dataUri(bytes) });
    const checksums = result.checks.find((c) => c.name === "checksums");
    expect(checksums?.verdict).toBe("fail");
    expect(result.status).toBe("failed");
  });

  it("fails artifacts-present when the asset bytes are missing", () => {
    const manifest = { artifacts: [{ id: "a1", file: "artifacts/foo.txt", source: { sha256: "x" } }], metrics: [] };
    const result = computeIntegrity(manifest, {});
    expect(result.checks.find((c) => c.name === "artifacts-present")?.verdict).toBe("fail");
  });

  it("skips artifacts with file: null (oversized/inline-only)", () => {
    const manifest = { artifacts: [{ id: "a1", file: null, source: {} }], metrics: [] };
    const result = computeIntegrity(manifest, {});
    expect(result.status).toBe("passed");
  });

  it("fails artifact-refs on a dangling artifactId", () => {
    const manifest = { artifacts: [], metrics: [{ label: "m1", status: "robust", artifactIds: ["ghost"] }] };
    const result = computeIntegrity(manifest, {});
    expect(result.checks.find((c) => c.name === "artifact-refs")?.verdict).toBe("fail");
  });

  it("fails findings-sourced on a substantive metric with no artifactIds", () => {
    const manifest = { artifacts: [], metrics: [{ label: "m1", status: "robust" }] };
    const result = computeIntegrity(manifest, {});
    expect(result.checks.find((c) => c.name === "findings-sourced")?.verdict).toBe("fail");
  });

  it("does not require sourcing for a descriptive metric", () => {
    const manifest = { artifacts: [], metrics: [{ label: "m1", status: "descriptive", statement: "just a note" }] };
    const result = computeIntegrity(manifest, {});
    expect(result.checks.find((c) => c.name === "findings-sourced")?.verdict).toBe("pass");
  });
});

describe("reverifySubmission — orchestration", () => {
  const gitExcerpt = { available: true, commits: [] as never[] };

  it("degrades to a single not-derivable entry for an unrecognizable payload", () => {
    const result = reverifySubmission("not an object", gitExcerpt);
    expect(result).toEqual([
      {
        check: "payload-shape",
        status: "not-derivable",
        detail: "the submitted payload is not a recognizable object; none of the mechanical re-checks could run.",
      },
    ]);
  });

  it("never throws on a payload with the right top-level shape but garbage inside", () => {
    const payload = {
      files: {
        decisionLog: { content: 123 }, // wrong type on purpose
        executionPlans: [{ component: "01-x", versions: "not an array", results: null }],
        reviews: "also wrong",
      },
    };
    expect(() => reverifySubmission(payload, gitExcerpt)).not.toThrow();
  });

  it("emits a trailer check for each plan version and a git-timing flag when history is empty", () => {
    const payload = {
      files: {
        decisionLog: { content: "" },
        reviews: [],
        executionPlans: [
          {
            component: "01-descriptives",
            versions: [
              {
                version: 1,
                path: "plans/execution/01-descriptives/v1.md",
                content: "# Plan\n\nBody.\n\nSigned off: Ada, 2026-08-10\n",
              },
            ],
          },
        ],
      },
    };
    const result = reverifySubmission(payload, { available: true, commits: [] });
    const trailer = result.find((r) => r.check === "trailer:01-descriptives v1");
    expect(trailer?.status).toBe("match");
    const timing = result.find((r) => r.check === "git-timing:01-descriptives v1");
    expect(timing?.status).toBe("not-derivable"); // no commits at all in the excerpt
  });

  it("flags a signed plan whose trailer date postdates every commit touching it", () => {
    const payload = {
      files: {
        decisionLog: { content: "" },
        reviews: [],
        executionPlans: [
          {
            component: "01-descriptives",
            versions: [
              {
                version: 1,
                path: "plans/execution/01-descriptives/v1.md",
                content: "# Plan\n\nBody.\n\nSigned off: Ada, 2026-08-10\n",
              },
            ],
          },
        ],
      },
    };
    const gitExcerptLate = {
      available: true,
      commits: [
        { hash: "a1", authorDate: "2026-08-14T09:00:00Z", authorName: "Ada", subject: "plans: v1.md draft" },
      ],
    };
    const result = reverifySubmission(payload, gitExcerptLate);
    const timing = result.find((r) => r.check === "git-timing:01-descriptives v1");
    expect(timing?.status).toBe("flag");
    expect(timing?.detail).toContain("2026-08-10");
    expect(timing?.detail).toContain("2026-08-14");
  });

  it("matches git-timing when a commit touching the file (via files[]) predates the claim", () => {
    const payload = {
      files: {
        decisionLog: { content: "" },
        reviews: [],
        executionPlans: [
          {
            component: "01-descriptives",
            versions: [
              {
                version: 1,
                path: "plans/execution/01-descriptives/v1.md",
                content: "# Plan\n\nBody.\n\nSigned off: Ada, 2026-08-10\n",
              },
            ],
          },
        ],
      },
    };
    const gitExcerptOnTime = {
      available: true,
      commits: [
        {
          hash: "a1", authorDate: "2026-08-09T09:00:00Z", authorName: "Ada", subject: "draft",
          files: ["plans/execution/01-descriptives/v1.md"],
        },
      ],
    };
    const result = reverifySubmission(payload, gitExcerptOnTime);
    const timing = result.find((r) => r.check === "git-timing:01-descriptives v1");
    expect(timing?.status).toBe("match");
  });

  it("flags a low-Decisions plan with no matching decision-log override line", () => {
    const scorecardContent = [
      "# Review",
      "```json board-scorecard",
      JSON.stringify({
        component: "01-descriptives", planVersion: 1,
        channels: [{ id: "decisions", name: "Decisions & reasons", score: 1 }],
        date: "2026-08-09",
      }),
      "```",
    ].join("\n");
    const payload = {
      files: {
        decisionLog: { content: "## 2026-08-10 09:00\n\nSomething unrelated.\n" },
        reviews: [{ path: "plans/reviews/01-descriptives-v1.md", content: scorecardContent }],
        executionPlans: [
          {
            component: "01-descriptives",
            versions: [
              { version: 1, path: "plans/execution/01-descriptives/v1.md", content: "# Plan\n\nSigned off: Ada, 2026-08-10\n" },
            ],
          },
        ],
      },
    };
    const result = reverifySubmission(payload, gitExcerpt);
    const override = result.find((r) => r.check === "decisions-override:01-descriptives v1");
    expect(override?.status).toBe("flag");
  });

  it("matches when the required low-Decisions override line IS present", () => {
    const scorecardContent = [
      "```json board-scorecard",
      JSON.stringify({
        component: "01-descriptives", planVersion: 1,
        channels: [{ id: "decisions", name: "Decisions & reasons", score: 1 }],
        date: "2026-08-09",
      }),
      "```",
    ].join("\n");
    const overrideLine = "Signed off despite low Decisions score (channel=1) — student proceeded without revision.";
    const payload = {
      files: {
        decisionLog: { content: `## 2026-08-10 09:00\n\n**Effect on execution:** ${overrideLine}\n` },
        reviews: [{ path: "plans/reviews/01-descriptives-v1.md", content: scorecardContent }],
        executionPlans: [
          {
            component: "01-descriptives",
            versions: [
              { version: 1, path: "plans/execution/01-descriptives/v1.md", content: "# Plan\n\nSigned off: Ada, 2026-08-10\n" },
            ],
          },
        ],
      },
    };
    const result = reverifySubmission(payload, gitExcerpt);
    const override = result.find((r) => r.check === "decisions-override:01-descriptives v1");
    expect(override?.status).toBe("match");
  });

  it("reports not-derivable for a signed plan version with no matching scorecard", () => {
    const payload = {
      files: {
        decisionLog: { content: "" },
        reviews: [],
        executionPlans: [
          {
            component: "01-descriptives",
            versions: [
              { version: 1, path: "plans/execution/01-descriptives/v1.md", content: "# Plan\n\nSigned off: Ada, 2026-08-10\n" },
            ],
          },
        ],
      },
    };
    const result = reverifySubmission(payload, gitExcerpt);
    const override = result.find((r) => r.check === "decisions-override:01-descriptives v1");
    expect(override?.status).toBe("not-derivable");
  });
});

describe("findFreshestManifest", () => {
  it("picks the manifest with the latest capturedAt across components/versions", () => {
    const payload = {
      files: {
        executionPlans: [
          { component: "a", results: [{ manifest: { capturedAt: "2026-08-01 10:00", score: "old" } }] },
          { component: "b", results: [{ manifest: { capturedAt: "2026-08-10 10:00", score: "new" } }] },
        ],
      },
    };
    expect(findFreshestManifest(payload)?.score).toBe("new");
  });
  it("returns null when there are no results bundles", () => {
    expect(findFreshestManifest({ files: { executionPlans: [] } })).toBeNull();
  });
});
