// Contract-drift alarm: fixtures include the LITERAL plugin templates and REAL
// artifacts produced by the v0.1.0 pressure tests. Template fixtures are the
// CONTRACT tests (current format must parse fully); the real v0.1 artifacts are
// TOLERANCE tests (old format must keep parsing, with v0.3 fields defaulted).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTRACT_SECTIONS,
  METHOD_SECTIONS,
  allFiles,
  isDoneStatus,
  parseDecisionLog,
  parseExecutionPlan,
  parseHistory,
  parseMasterPlan,
  parseScorecard,
  parseServes,
  payloadContentHash,
  preRenewalSlugs,
  slugFromLink,
} from "./parse";
import { devData } from "../dev-data";

const TEMPLATES = join(
  __dirname,
  "../../../skills/managing-aict/templates",
);
const FIXTURES = join(__dirname, "__fixtures__");

const read = (p: string) => readFileSync(p, "utf-8");

describe("master plan parsing (contract: current template)", () => {
  it("parses the literal template with RQs and Serves", () => {
    const mp = parseMasterPlan(read(join(TEMPLATES, "master-plan.md")));
    expect(mp.ok).toBe(true);
    expect(mp.raw).toContain("<!-- aict:master-plan -->");
    expect(mp.researchQuestions.length).toBe(2);
    expect(mp.researchQuestions[0].num).toBe(1);
    expect(mp.components.length).toBeGreaterThanOrEqual(2);
    expect(mp.components[1].serves).toBe("RQ1");
    expect(mp.contextMd).not.toContain("### Research questions");
  });

  it("parses the dev-data sample: statuses, serves, RQs", () => {
    const mp = parseMasterPlan(devData.files.masterPlan.content);
    expect(mp.ok).toBe(true);
    expect(mp.components.map((c) => c.status)).toEqual([
      "done",
      "done",
      "in progress",
      "planned",
    ]);
    expect(mp.components.map((c) => c.serves)).toEqual([
      "—",
      "RQ1, RQ2",
      "RQ1",
      "RQ2",
    ]);
    expect(mp.researchQuestions.map((q) => q.num)).toEqual([1, 2]);
    expect(mp.components[1].planLink).toContain("02-data-cleaning");
  });

  it("degrades to ok:false on non-contract markdown", () => {
    const mp = parseMasterPlan("# Something else entirely\n\nprose only");
    expect(mp.ok).toBe(false);
    expect(mp.raw).toContain("Something else");
  });
});

describe("master plan parsing (tolerance: real v0.1 artifact)", () => {
  it("still parses, with v0.3 fields defaulted", () => {
    const mp = parseMasterPlan(read(join(FIXTURES, "real-master-plan.md")));
    expect(mp.ok).toBe(true);
    expect(mp.lastUpdated).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(mp.components.length).toBe(4);
    expect(mp.components[0].status).toBe("done");
    expect(mp.researchQuestions).toEqual([]);
    expect(mp.components.every((c) => c.serves === "")).toBe(true);
  });
});

describe("serves normalization", () => {
  it("extracts and canonicalizes RQ tokens", () => {
    expect(parseServes("RQ1, RQ2").tokens).toEqual(["RQ1", "RQ2"]);
    expect(parseServes("rq1,rq2").tokens).toEqual(["RQ1", "RQ2"]);
    expect(parseServes("`RQ3`").tokens).toEqual(["RQ3"]);
    expect(parseServes("RQ1 and RQ1").tokens).toEqual(["RQ1"]);
  });
  it("distinguishes infrastructure dash from empty", () => {
    expect(parseServes("—").isInfra).toBe(true);
    expect(parseServes("-").isInfra).toBe(true);
    expect(parseServes("").isEmpty).toBe(true);
    expect(parseServes("").isInfra).toBe(false);
    expect(parseServes(null).isEmpty).toBe(true);
  });
});

describe("decision log parsing", () => {
  it("returns zero entries for the literal template (header only)", () => {
    const entries = parseDecisionLog(read(join(TEMPLATES, "decision-log.md")));
    expect(entries.length).toBe(0);
  });

  it("parses dev-data entries with fields and late-captured flag", () => {
    const entries = parseDecisionLog(devData.files.decisionLog.content);
    expect(entries.length).toBe(3);
    expect(entries[0].timestamp).toBe("2026-07-01 10:12");
    expect(entries[0].lateCaptured).toBe(false);
    expect(entries[2].lateCaptured).toBe(true);
    const labels = entries[0].fields.map((f) => f.label);
    expect(labels).toContain("Context");
    expect(labels).toContain("Question (Claude)");
    expect(labels).toContain("Response (researcher)");
    expect(labels).toContain("Effect on execution");
  });

  it("handles Decision (Claude) entries", () => {
    const entries = parseDecisionLog(devData.files.decisionLog.content);
    const labels = entries[1].fields.map((f) => f.label);
    expect(labels).toContain("Decision (Claude)");
  });

  it("flags auto-captured decision entries", () => {
    const md = "# Decision log\n\n## 2026-07-17 14:05 (auto-captured)\nContext: x\n";
    const entries = parseDecisionLog(md);
    expect(entries[0].autoCaptured).toBe(true);
    expect(entries[0].lateCaptured).toBe(false);
  });
});

describe("execution plan parsing (contract: current template)", () => {
  it("extracts the master-plan link from a combined preamble line", () => {
    const raw = [
      "# Readability — Execution Plan v1",
      "",
      "Component: `01-readability` · Master plan: [Project plan](../../master-plan.md) · Date: 2026-07-18",
      "",
      "## Context",
      "Context.",
    ].join("\n");

    expect(parseExecutionPlan(raw).masterPlan).toBe(
      "[Project plan](../../master-plan.md)",
    );
  });

  it("defaults an absent master-plan field to null", () => {
    const raw = [
      "# Readability — Execution Plan v1",
      "",
      "## Context",
      "Context.",
    ].join("\n");

    expect(parseExecutionPlan(raw).masterPlan).toBeNull();
  });

  it("parses the single-narrative template, Context first", () => {
    const ep = parseExecutionPlan(read(join(TEMPLATES, "execution-plan.md")));
    expect(ep.ok).toBe(true);
    expect(ep.sections.map((s) => s.heading)).toEqual([
      "Context",
      "Goal and success criteria",
      "Decisions",
      "Approach",
      "Build steps",
      "Verification",
      "Out of scope",
      "Files to reuse",
      "Sources",
    ]);
    expect(ep.goal).not.toBeNull();
    expect(ep.serves).toContain("RQ");
  });

  it("is one narrative with no Part 1/Part 2 banners", () => {
    const raw = read(join(TEMPLATES, "execution-plan.md"));
    expect(raw).not.toContain("## Part 1");
    expect(raw).not.toContain("## Part 2");
    const ep = parseExecutionPlan(raw);
    expect(ep.ok).toBe(true);
    // Every section is classified into a detail-level tier (contract or method).
    const tiers = [...CONTRACT_SECTIONS, ...METHOD_SECTIONS];
    for (const h of ep.sections.map((s) => s.heading)) {
      expect(tiers).toContain(h);
    }
  });

  it("keeps canonical trailer lines out of the mutable draft template", () => {
    const lines = read(join(TEMPLATES, "execution-plan.md")).split(/\r?\n/);
    expect(lines.some((line) => /^Signed off: .+$/.test(line.trim()))).toBe(false);
    expect(lines.some((line) => /^Amendment recorded, \d{4}-\d{2}-\d{2}$/.test(line.trim()))).toBe(false);
  });

  it("parses goal, serves, version, supersedes, sign-off from dev-data v2", () => {
    const v2 = devData.files.executionPlans[0].versions[1];
    const ep = parseExecutionPlan(v2.content);
    expect(ep.ok).toBe(true);
    expect(ep.version).toBe(2);
    expect(ep.supersedes).toContain("v1");
    expect(ep.signedOff).toContain("Jane Doe");
    expect(ep.goal).toContain("documented analysis sample");
    expect(ep.serves).toBe("RQ1, RQ2");
  });

  it("detects missing sign-off on drafts", () => {
    const draft = devData.files.executionPlans[1].draft!;
    const ep = parseExecutionPlan(draft.content);
    expect(ep.ok).toBe(true);
    expect(ep.signedOff).toBeNull();
    expect(ep.serves).toBe("RQ1");
  });

  it("rejects an interior signature as malformed instead of signed", () => {
    const ep = parseExecutionPlan(
      "# X — Execution Plan v1\n\nSigned off: BK, 2026-07-18\n\n" +
        "## Context\n\nContext.\n\n## Goal and success criteria\n\nGoal.\n",
    );
    expect(ep.ok).toBe(true);
    expect(ep.signedOff).toBeNull();
    expect(ep.trailerState).toBe("malformed");
  });

  it("recognizes an amendment without claiming a sign-off", () => {
    const ep = parseExecutionPlan(
      "# X — Execution Plan v2\n\n## Context\n\nContext.\n\n" +
        "## Goal and success criteria\n\nGoal.\n\n" +
        "Amendment recorded, 2026-07-18\n",
    );
    expect(ep.ok).toBe(true);
    expect(ep.signedOff).toBeNull();
    expect(ep.trailerState).toBe("amendment");
  });

  it("includes amendment fixtures for executed and awaiting-recommitment components", () => {
    const executed = devData.files.executionPlans.find(
      (group) => group.component === "02-data-cleaning",
    )!;
    expect(parseExecutionPlan(executed.versions.at(-1)!.content).trailerState).toBe("amendment");
    expect(executed.results?.length).toBeGreaterThan(0);

    const awaiting = devData.files.executionPlans.find(
      (group) => group.component === "04-regression",
    )!;
    expect(parseExecutionPlan(awaiting.versions.at(-1)!.content).trailerState).toBe("amendment");
    expect(awaiting.draft).toBeUndefined();
  });
});

describe("execution plan parsing (tolerance: real v0.1 artifact)", () => {
  it("still parses without a Goal section", () => {
    const ep = parseExecutionPlan(read(join(FIXTURES, "real-execution-plan.md")));
    expect(ep.ok).toBe(true);
    expect(ep.version).toBe(1);
    expect(ep.componentSlug).toBe("01-full-pipeline");
    expect(ep.goal).toBeNull();
    expect(ep.serves).toBeNull();
    expect(ep.sections.length).toBeGreaterThanOrEqual(6);
  });
});

describe("scorecard parsing", () => {
  // Legacy v1/v2 scorecards still parse (for the "legacy review" affordance).
  it("parses a legacy v1 scorecard (no threshold block)", () => {
    const raw =
      '```json board-scorecard\n{"schemaVersion":1,"component":"02-x","planVersion":2,"planPath":"p","rubricVersion":"0.1","date":"d","items":[{"id":1,"score":2}],"raw":18,"applicableMax":22,"percent":82,"band":"strong"}\n```';
    const sc = parseScorecard(raw);
    expect(sc).not.toBeNull();
    expect(sc!.threshold).toBeUndefined();
    expect(sc!.percent).toBe(82);
  });

  it("parses a legacy v2 PASS scorecard with threshold checks", () => {
    const raw =
      '```json board-scorecard\n{"schemaVersion":2,"component":"03-x","planVersion":1,"planPath":"p","rubricVersion":"0.2","date":"d","threshold":{"verdict":"pass","checks":[{"id":"T1","result":"pass"}],"failures":[]},"items":[{"id":"G1","score":2}],"raw":11,"applicableMax":14,"percent":79,"band":"strong"}\n```';
    const sc = parseScorecard(raw);
    expect(sc!.threshold!.verdict).toBe("pass");
    expect(sc!.items!.length).toBe(1);
  });

  it("treats schemaVersion 2 WITHOUT a valid threshold as malformed", () => {
    const bad = '```json board-scorecard\n{"schemaVersion":2,"items":[],"band":"strong","percent":90}\n```';
    expect(parseScorecard(bad)).toBeNull();
    const badVerdict =
      '```json board-scorecard\n{"schemaVersion":2,"threshold":{"verdict":"maybe","checks":[]},"items":[]}\n```';
    expect(parseScorecard(badVerdict)).toBeNull();
  });

  it("returns null when the fence is absent or invalid", () => {
    expect(parseScorecard("# Review\n\nNo fence here")).toBeNull();
    expect(parseScorecard("```json board-scorecard\n{broken\n```")).toBeNull();
  });

  it("parses the scorecard template's fence shape without throwing", () => {
    const tpl = read(join(TEMPLATES, "review-scorecard.md"));
    expect(() => parseScorecard(tpl)).not.toThrow();
  });

  const V3 = (over = "") =>
    '```json board-scorecard\n{"schemaVersion":3,"status":"scored","component":"03-x","planVersion":1,"planPath":"plans/execution/03-x/v1.md","rubricVersion":"0.4","date":"2026-07-14","channels":[{"id":"goal","score":3},{"id":"decisions","score":2},{"id":"steps","score":2},{"id":"validation","score":1},{"id":"boundaries","score":0}],"total":8,"max":15,"profile":"G3·D2·S2·V1·B0"' +
    over +
    "}\n```";

  it("parses a v3 scored scorecard with the five channels", () => {
    const sc = parseScorecard(V3());
    expect(sc).not.toBeNull();
    expect(sc!.status).toBe("scored");
    expect(sc!.channels!.map((c) => c.id)).toEqual([
      "goal",
      "decisions",
      "steps",
      "validation",
      "boundaries",
    ]);
    expect(sc!.total).toBe(8);
  });

  it("parses a v3 unscorable scorecard", () => {
    const raw =
      '```json board-scorecard\n{"schemaVersion":3,"status":"unscorable","component":"03-x","planVersion":1,"planPath":"p","rubricVersion":"0.4","date":"2026-07-14","reason":"no extractable goal"}\n```';
    const sc = parseScorecard(raw);
    expect(sc!.status).toBe("unscorable");
    expect(sc!.reason).toContain("goal");
  });

  const v3channels =
    '"channels":[{"id":"goal","score":3},{"id":"decisions","score":2},{"id":"steps","score":2},{"id":"validation","score":1},{"id":"boundaries","score":0}]';
  const v3head =
    '{"schemaVersion":3,"status":"scored","component":"x","planVersion":1,"planPath":"p","rubricVersion":"0.4","date":"d",';
  const fence = (mid: string) =>
    "```json board-scorecard\n" + v3head + mid + "}\n```";

  it("rejects reordered channels, inconsistent total, or non-array collections", () => {
    // reordered channels
    expect(
      parseScorecard(
        fence(
          '"channels":[{"id":"decisions","score":2},{"id":"goal","score":3},{"id":"steps","score":2},{"id":"validation","score":1},{"id":"boundaries","score":0}]',
        ),
      ),
    ).toBeNull();
    // total inconsistent with the sum (8, not 99)
    expect(parseScorecard(fence(v3channels + ',"total":99'))).toBeNull();
    // integrityFlags is a string, not an array (would crash the render)
    expect(parseScorecard(fence(v3channels + ',"integrityFlags":"none"'))).toBeNull();
    // biggestLeak is a string, not an object
    expect(parseScorecard(fence(v3channels + ',"biggestLeak":"steps"'))).toBeNull();
  });

  it("derives total from the channel scores when it is absent", () => {
    const sc = parseScorecard(fence(v3channels));
    expect(sc!.total).toBe(8);
  });

  it("rejects a v3 scored card that is missing a channel or has an out-of-range score", () => {
    const missing =
      '```json board-scorecard\n{"schemaVersion":3,"status":"scored","component":"x","planVersion":1,"planPath":"p","rubricVersion":"0.4","date":"d","channels":[{"id":"goal","score":3},{"id":"decisions","score":2},{"id":"steps","score":2},{"id":"validation","score":1}]}\n```';
    expect(parseScorecard(missing)).toBeNull();
    const badScore =
      '```json board-scorecard\n{"schemaVersion":3,"status":"scored","component":"x","planVersion":1,"planPath":"p","rubricVersion":"0.4","date":"d","channels":[{"id":"goal","score":4},{"id":"decisions","score":2},{"id":"steps","score":2},{"id":"validation","score":1},{"id":"boundaries","score":0}]}\n```';
    expect(parseScorecard(badScore)).toBeNull();
  });
});

describe("payload content hash", () => {
  it("is stable across ordering and sensitive to content", () => {
    const a = payloadContentHash([
      { path: "b.md", content: "two" },
      { path: "a.md", content: "one" },
    ]);
    const b = payloadContentHash([
      { path: "a.md", content: "one" },
      { path: "b.md", content: "two" },
    ]);
    expect(a).toBe(b);
    const c = payloadContentHash([
      { path: "a.md", content: "one!" },
      { path: "b.md", content: "two" },
    ]);
    expect(c).not.toBe(a);
  });
});

describe("author field does not affect payload hash", () => {
  it("hash is over files only, unaffected by annotation shape", () => {
    const files = [{ path: "a.md", content: "x" }, { path: "b.md", content: "y" }];
    // payloadContentHash takes the file list; annotations are never hashed.
    expect(payloadContentHash(files as never)).toBe(payloadContentHash(files as never));
  });
});

describe("results layer", () => {
  const trackerFixtureWithStatus = (status: string) =>
    "# T\n\n## Components\n\n" +
    "| # | Component | Status | Execution plan | Outcome / notes | Serves |\n" +
    "|---|---|---|---|---|---|\n" +
    `| 1 | X | ${status} | — | — | — |\n`;

  it("parses done (verified) tracker status", () => {
    const mp = parseMasterPlan(trackerFixtureWithStatus("done (verified)"));
    expect(mp.components[0].status).toBe("done (verified)");
  });

  it("parses the v0.20 validation-keyed done statuses", () => {
    for (const status of [
      "done (validated)",
      "done (unvalidated)",
      "done (retrofit)",
    ]) {
      expect(
        parseMasterPlan(trackerFixtureWithStatus(status)).components[0].status,
      ).toBe(status);
    }
  });

  it("isDoneStatus covers the done family and nothing else", () => {
    expect(isDoneStatus("done")).toBe(true);
    expect(isDoneStatus("done (verified)")).toBe(true);
    expect(isDoneStatus("done (validated)")).toBe(true);
    expect(isDoneStatus("planned")).toBe(false);
  });

  it("allFiles includes results bundle text files", () => {
    const data = {
      files: {
        masterPlan: { path: "plans/master-plan.md", content: "m" },
        decisionLog: { path: "plans/decision-log.md", content: "d" },
        executionPlans: [
          {
            component: "01-x",
            versions: [{ path: "plans/execution/01-x/v1.md", content: "v", version: 1 }],
            results: [
              {
                resultsVersion: 1,
                dir: "plans/execution/01-x/results/r1",
                manifest: null,
                manifestRaw: { path: "plans/execution/01-x/results/r1/manifest.json", content: "{}" },
                report: { path: "plans/execution/01-x/results/r1/report.md", content: "# R" },
                verdict: null,
                verdictRaw: { path: "plans/execution/01-x/results/r1/verdict.json", content: "{}" },
                scripts: [{ path: "plans/execution/01-x/results/r1/scripts/a.R", content: "x" }],
                assets: {},
                publishedReport: { path: "plans/reports/01-x-r1-report.md", content: "R" },
              },
              {
                resultsVersion: 2,
                dir: "plans/execution/01-x/results/r2",
                manifest: null,
                manifestRaw: { path: "plans/execution/01-x/results/r2/manifest.json", content: "{}" },
                report: null,
                verdict: null,
                verdictRaw: null,
                scripts: [],
                assets: {},
                publishedReport: null,
              },
            ],
          },
        ],
        reviews: [],
      },
    };
    const paths = allFiles(data as never).map((f) => f.path);
    expect(paths).toContain("plans/execution/01-x/results/r1/manifest.json");
    expect(paths).toContain("plans/execution/01-x/results/r1/report.md");
    expect(paths).toContain("plans/execution/01-x/results/r1/verdict.json");
    expect(paths).toContain("plans/execution/01-x/results/r1/scripts/a.R");
    expect(
      paths.filter((p) => p === "plans/reports/01-x-r1-report.md").length,
    ).toBe(1);
  });
});

describe("Python/TypeScript payload file parity", () => {
  it("matches the pinned payload_files vector", () => {
    const file = (path: string) => ({ path, content: path });
    const data = {
      files: {
        masterPlan: file("plans/master-plan.md"),
        decisionLog: file("plans/decision-log.md"),
        executionPlans: [{
          versions: [file("plans/execution/01-x/v1.md")],
          draftSnapshots: [file("plans/execution/01-x/v1-draft-1.md")],
          draft: file("plans/execution/01-x/.draft-v2.md"),
          results: [{
            manifestRaw: file("plans/execution/01-x/results/r1/manifest.json"),
            report: file("plans/execution/01-x/results/r1/report.md"),
            verdictRaw: file("plans/execution/01-x/results/r1/verdict.json"),
            scripts: [
              file("plans/execution/01-x/results/r1/scripts/a.py"),
              file("plans/execution/01-x/results/r1/scripts/b.R"),
            ],
            publishedReport: file("plans/reports/01-x-r1-report.md"),
          }],
        }],
        reviews: [file("plans/reviews/r.md")],
        history: file("plans/history.md"),
        archives: [file("plans/archive/master-plan-2026-01-01.md")],
      },
    };
    const expected = [
      "plans/master-plan.md", "plans/decision-log.md",
      "plans/execution/01-x/v1.md",
      "plans/execution/01-x/v1-draft-1.md",
      "plans/execution/01-x/.draft-v2.md",
      "plans/execution/01-x/results/r1/manifest.json",
      "plans/execution/01-x/results/r1/report.md",
      "plans/execution/01-x/results/r1/verdict.json",
      "plans/execution/01-x/results/r1/scripts/a.py",
      "plans/execution/01-x/results/r1/scripts/b.R",
      "plans/reports/01-x-r1-report.md",
      "plans/reviews/r.md", "plans/history.md",
      "plans/archive/master-plan-2026-01-01.md",
    ].sort();

    expect(allFiles(data as never).map((f) => f.path).sort()).toEqual(expected);
  });
});

describe("history (v0.7): reconstructed pre-adoption record", () => {
  it("parses date-granularity entries with fields", () => {
    const entries = parseHistory(devData.files.history!.content);
    expect(entries.length).toBe(2);
    expect(entries[0].date).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
    expect(entries[0].sortKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      entries.some((e) => e.fields.some((f) => f.label === "Evidence")),
    ).toBe(true);
  });

  it("does not cross-parse a month header as a decision-log entry", () => {
    // the decision-log parser requires HH:MM; history headers never appear there
    expect(parseDecisionLog(devData.files.history!.content)).toEqual([]);
  });

  it("literal history.md template parses without throwing", () => {
    expect(() => parseHistory(read(join(TEMPLATES, "history.md")))).not.toThrow();
  });
});

describe("plan provenance (v0.3)", () => {
  it("a prospective plan (no Provenance line) has null provenance", () => {
    const p = parseExecutionPlan(
      "# X — Execution Plan v1\n\nComponent: `01-x` · Date: 2026-07-01\n\n" +
        "## Goal and success criteria\n\nDo it.\n",
    );
    expect(p.provenance).toBeNull();
  });

  it("a declared retrospective plan surfaces its Provenance", () => {
    const desc = devData.files.executionPlans.find(
      (g) => g.component === "03-descriptives",
    )!.versions[0];
    expect(parseExecutionPlan(desc.content).provenance).toMatch(/^retrospective/i);
  });
});

describe("allFiles present-only history (hash stability)", () => {
  it("includes history when present, excludes it when absent, without perturbing other hashes", () => {
    expect(allFiles(devData).map((f) => f.path)).toContain("plans/history.md");

    const noHistory = { files: { ...devData.files, history: undefined } };
    expect(allFiles(noHistory).map((f) => f.path)).not.toContain(
      "plans/history.md",
    );

    // present-only: everything-but-history hashes identically either way
    const a = allFiles(devData).filter((f) => f.path !== "plans/history.md");
    expect(payloadContentHash(a)).toBe(payloadContentHash(allFiles(noHistory)));
  });
});

describe("renewal (v0.10): Renewed line, Foundations, archives, pre-renewal slugs", () => {
  const renewedMaster =
    "<!-- research-plans:master-plan -->\n# P — Master Plan\n\n" +
    "Last updated: 2026-07-09\nInitialized: 2026-03-02 14:10\n" +
    "Renewed: 2026-07-09 — pivot from X to Y\n\n" +
    "## Project context\n\nNew direction.\n\n" +
    "## Components\n\n" +
    "| # | Component | Status | Execution plan | Outcome / notes | Serves |\n" +
    "|---|---|---|---|---|---|\n" +
    "| 1 | Carried | done | [v1](execution/01-carried/v1.md) | — | — |\n\n" +
    "## Foundations\n\nRenewed from archive/master-plan-2026-07-09.md. Not carried: 02-explore.\n";

  it("parses the Renewed line into {date, reason}", () => {
    const mp = parseMasterPlan(renewedMaster);
    expect(mp.ok).toBe(true);
    expect(mp.renewed).toEqual({ date: "2026-07-09", reason: "pivot from X to Y" });
  });

  it("renewed defaults to null (template placeholder and old plans)", () => {
    expect(parseMasterPlan(read(join(TEMPLATES, "master-plan.md"))).renewed).toBeNull();
    expect(parseMasterPlan(devData.files.masterPlan.content).renewed).not.toBeNull();
  });

  it("surfaces the Foundations section body", () => {
    const mp = parseMasterPlan(renewedMaster);
    expect(mp.foundationsMd).toContain("archive/master-plan-2026-07-09.md");
    expect(parseMasterPlan("# X\n\n## Components\n\n| a |\n|---|\n| 1 |\n").foundationsMd).toBeNull();
  });

  it("slugFromLink extracts the execution slug", () => {
    expect(slugFromLink("[v1](execution/01-carried/v1.md)")).toBe("01-carried");
    expect(slugFromLink("—")).toBeNull();
  });

  it("allFiles includes archives present-only, hash-stable otherwise", () => {
    const withArchive = {
      files: {
        ...devData.files,
        archives: [
          { path: "plans/archive/master-plan-2026-07-01.md", content: "old", archivedOn: "2026-07-01" },
        ],
      },
    };
    expect(allFiles(withArchive as never).map((f) => f.path)).toContain(
      "plans/archive/master-plan-2026-07-01.md",
    );
    const a = allFiles(withArchive as never).filter(
      (f) => f.path !== "plans/archive/master-plan-2026-07-01.md",
    );
    const noArchives = { files: { ...devData.files, archives: undefined } };
    expect(payloadContentHash(a)).toBe(payloadContentHash(allFiles(noArchives as never)));
  });

  it("preRenewalSlugs: linked only in an archive → flagged; current or unknown → not", () => {
    const data = {
      files: {
        masterPlan: { content: renewedMaster },
        archives: [{ content: "| 9 | Legacy | done | [v1](execution/09-legacy/v1.md) | — | — |" }],
        executionPlans: [
          { component: "01-carried" },
          { component: "09-legacy" },
          { component: "10-orphan" },
        ],
      },
    };
    const s = preRenewalSlugs(data as never);
    expect(s.has("09-legacy")).toBe(true);
    expect(s.has("01-carried")).toBe(false);
    expect(s.has("10-orphan")).toBe(false);
    expect(preRenewalSlugs({ files: { ...data.files, archives: undefined } } as never).size).toBe(0);
  });
});

describe("allFiles committed draft snapshots (feature #1)", () => {
  it("includes vN-draft-K snapshots in the hashed file set", () => {
    const paths = allFiles(devData).map((f) => f.path);
    expect(paths).toContain("plans/execution/03-descriptives/v2-draft-1.md");
    expect(paths).toContain("plans/execution/03-descriptives/v2-draft-2.md");
  });

  it("a group without snapshots contributes none, keeping other hashes stable", () => {
    const stripped = {
      files: {
        ...devData.files,
        executionPlans: devData.files.executionPlans.map((g) => ({
          ...g,
          draftSnapshots: undefined,
        })),
      },
    };
    const paths = allFiles(stripped).map((f) => f.path);
    expect(paths.some((p) => /v\d+-draft-\d+\.md$/.test(p))).toBe(false);
  });
});
