import { describe, it, expect } from "vitest";
import {
  newUuid, getClientId, targetHash, isStale, partitionComments, applyPostResult, buildCommentBody,
} from "./hostedComments";
import type {
  BoardData, StoredComment, Annotation, ExecutionPlanGroup, ResultsBundle,
  PlanCommentAnnotation, ResultCommentAnnotation, GeneralAnnotation,
} from "./types";

// Real-shaped BoardData: plans live under files.executionPlans (matches the
// payload board.py builds — see payload["files"]["executionPlans"] = exec_groups).
function boardWith(planContent: string, results?: ResultsBundle[]): BoardData {
  const execGroup: ExecutionPlanGroup = {
    component: "01-x",
    versions: [{ version: 1, content: planContent, path: "plans/execution/01-x/v1.md" }],
    results,
  };
  return {
    schemaVersion: 1,
    generatedAt: "t",
    mode: "hosted",
    focus: null,
    shareHash: "board-hash-1",
    project: { name: "proj" },
    git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "" },
      decisionLog: { path: "plans/decision-log.md", content: "" },
      executionPlans: [execGroup],
      reviews: [],
    },
  };
}

const REPORT_MARKER =
  '<!-- aict-report {"schemaVersion": 1, "component": "01-x", "bundle": 1, ' +
  '"plan": 1, "verdict": "pending", "generated": "2026-07-10T14:30:00Z"} -->';

// A board with a published report on 01-x r1, marker-stamped like the real
// generator output — see reportMarker.ts's ReportMarker doc comment.
function dataWithReport(): BoardData {
  const bundle: ResultsBundle = {
    ...resultsBundle(1, "manifest-v1"),
    publishedReport: {
      path: "plans/reports/01-x-r1-report.md",
      content: `${REPORT_MARKER}\n# R\n`,
    },
  };
  return boardWith("plan content", [bundle]);
}

// A board whose 01-x v1 plan content is exactly `content` — matches
// board.fnv1a_hex's Python-side pin in tests/test_board.py.
function planData(content: string): BoardData {
  return boardWith(content);
}

function resultsBundle(resultsVersion: number, manifestContent: string): ResultsBundle {
  return {
    resultsVersion,
    dir: `results/r${resultsVersion}`,
    manifest: null,
    manifestRaw: { path: `results/r${resultsVersion}/manifest.json`, content: manifestContent },
    report: null,
    verdict: null,
    verdictRaw: null,
    scripts: [],
    assets: {},
    publishedReport: null,
  };
}

// hostedComments.test.ts — cross-language pin, mirrors tests/test_board.py
// TestPullStaleness. Task 10 wires targetHash; this documents the contract now.

const planComment = (): PlanCommentAnnotation => ({
  id: "n1", type: "plan-comment", planPath: "plans/execution/01-x/v1.md", component: "01-x", version: 1,
  isDraft: false, quote: "q", prefix: "", suffix: "", sectionHeading: "", occurrenceIndex: 0, anchored: true,
  comment: "c",
});

const resultComment = (resultsVersion: number): ResultCommentAnnotation => ({
  id: "r1", type: "result-comment", component: "01-x", resultsVersion,
  target: { kind: "report" }, comment: "c",
});

const generalComment = (): GeneralAnnotation => ({ id: "g1", type: "general", view: "timeline", comment: "c" });

const stored = (over: Partial<StoredComment>): StoredComment =>
  ({ id: "s1", clientId: "cl1", author: "Ada", shareHash: "board-hash-1",
     docHash: null, annotation: planComment(), receivedAt: "t", ...over });

describe("ids", () => {
  it("newUuid is uuid-shaped and unique", () => {
    const a = newUuid(); const b = newUuid();
    expect(a).toMatch(/^[0-9a-f-]{36}$/i);
    expect(a).not.toBe(b);
  });
  it("getClientId persists across calls", () => {
    const mem: Record<string, string> = {};
    const storage = { getItem: (k: string) => mem[k] ?? null,
                      setItem: (k: string, v: string) => { mem[k] = v; } } as unknown as Storage;
    const id1 = getClientId(storage);
    const id2 = getClientId(storage);
    expect(id1).toBe(id2);
  });
});

describe("per-document staleness", () => {
  it("targetHash changes when the target plan content changes", () => {
    const h1 = targetHash(boardWith("original"), planComment());
    const h2 = targetHash(boardWith("edited"), planComment());
    expect(h1).not.toBe(h2);
    expect(h1).toBeTypeOf("string");
  });
  it("a comment on an unchanged doc is NOT stale", () => {
    const data = boardWith("original");
    const c = stored({ docHash: targetHash(data, planComment()) });
    expect(isStale(c, data)).toBe(false);
  });
  it("a comment on a CHANGED doc IS stale", () => {
    const c = stored({ docHash: targetHash(boardWith("original"), planComment()) });
    expect(isStale(c, boardWith("edited"))).toBe(true);
  });
  it("view/general comments (docHash null) fall back to whole-board shareHash", () => {
    const data = boardWith("x");
    const general: StoredComment = { ...stored({ docHash: null }), annotation: generalComment() };
    expect(isStale({ ...general, shareHash: "board-hash-1" }, data)).toBe(false);
    expect(isStale({ ...general, shareHash: "OLD" }, data)).toBe(true);
  });
  it("partitionComments splits live vs stale", () => {
    const data = boardWith("original");
    const fresh = stored({ id: "fresh", docHash: targetHash(data, planComment()) });
    const old = stored({ id: "old", docHash: "STALE" });
    const { live, stale } = partitionComments([fresh, old], data);
    expect(live.map((c) => c.id)).toEqual(["fresh"]);
    expect(stale.map((c) => c.id)).toEqual(["old"]);
  });

  it("a result-comment on results version N is NOT stale when a DIFFERENT results version is added/changed", () => {
    const before = boardWith("original", [resultsBundle(1, "manifest-v1")]);
    const annotation = resultComment(1);
    const docHash = targetHash(before, annotation);

    // A new results version 2 appears (or an existing v2 changes) — v1's
    // manifest content is untouched, so the comment on v1 must stay live.
    const after = boardWith("original", [resultsBundle(1, "manifest-v1"), resultsBundle(2, "manifest-v2-NEW")]);
    const c = stored({ docHash, annotation });
    expect(isStale(c, after)).toBe(false);

    // Sanity: changing v1 itself DOES stale the comment.
    const v1Changed = boardWith("original", [resultsBundle(1, "manifest-v1-EDITED")]);
    expect(isStale(c, v1Changed)).toBe(true);
  });

  it("a result-comment's targetHash ignores the DERIVED publishedReport/reportFormats fields but reacts to a real bundle field", () => {
    const annotation = resultComment(1);
    const base = resultsBundle(1, "manifest-v1");
    const docHash = targetHash(boardWith("original", [base]), annotation);

    // Regenerating the report (even just restamping the marker) must not
    // stale a result-comment on the unchanged, immutable bundle.
    const reportChanged = boardWith("original", [
      { ...base, publishedReport: { path: "plans/reports/x.md", content: "# R\n" } },
    ]);
    expect(targetHash(reportChanged, annotation)).toBe(docHash);

    // Running pandoc (which only flips reportFormats) must not stale it either.
    const formatsChanged = boardWith("original", [
      { ...base, reportFormats: { pdf: true, docx: false } },
    ]);
    expect(targetHash(formatsChanged, annotation)).toBe(docHash);

    // A real bundle field change (manifestRaw content) DOES stale it.
    const bundleChanged = boardWith("original", [resultsBundle(1, "manifest-v1-EDITED")]);
    expect(targetHash(bundleChanged, annotation)).not.toBe(docHash);
  });

  it("result targetHash changes with manifest.score but not with publishedReport", () => {
    const annotation = resultComment(1);
    const base = resultsBundle(1, "manifest-v1");
    const baseHash = targetHash(boardWith("original", [base]), annotation);
    const withScore: ResultsBundle = {
      ...base,
      manifest: {
        schemaVersion: 1,
        component: "01-x",
        resultsVersion: 1,
        planVersion: 1,
        provenance: "planned" as const,
        trigger: "initial" as const,
        capturedAt: "t",
        metrics: [],
        artifacts: [],
        score: {
          schemaVersion: 1,
          channels: [
            { id: "fidelity", name: "Fidelity", score: 3, basis: "all followed" },
            { id: "attainment", name: "Attainment", score: 3, basis: "all met" },
            { id: "integrity", name: "Integrity", score: 3, basis: "all pass" },
          ],
          profile: "F3·A3·I3",
          total: 9,
          max: 9,
          computedAt: "t",
        },
      },
    };
    expect(targetHash(boardWith("original", [withScore]), annotation)).not.toBe(baseHash);
    const withReport = {
      ...base,
      publishedReport: { path: "plans/reports/x.md", content: "# regenerated\n" },
    };
    expect(targetHash(boardWith("original", [withReport]), annotation)).toBe(baseHash);
  });
});

describe("targetHash: reports branch + cross-language pin", () => {
  it("reports doc-comment hashes the report body without the marker line", () => {
    const d = dataWithReport(); // bundle.publishedReport.content = `${MARKER}\n# R\n`
    const a = {
      id: "1", type: "doc-comment", view: "reports",
      docKey: "plans/reports/01-x-r1-report.md", scope: "", quote: "q", prefix: "",
      suffix: "", sectionHeading: "", occurrenceIndex: 0, anchored: true, comment: "c",
    } as const;
    const h1 = targetHash(d, a);
    expect(h1).not.toBeNull();
    // regenerating with ONLY a new marker timestamp must not invalidate comments
    const d2 = structuredClone(d);
    d2.files.executionPlans[0].results![0].publishedReport!.content =
      d.files.executionPlans[0].results![0].publishedReport!.content.replace("14:30", "15:00");
    expect(targetHash(d2, a)).toBe(h1);
    // a body change DOES invalidate
    const d3 = structuredClone(d);
    d3.files.executionPlans[0].results![0].publishedReport!.content += "\nmore";
    expect(targetHash(d3, a)).not.toBe(h1);
  });

  it("cross-language FNV pins match tests/test_board.py TestPullStaleness", () => {
    // targetHash(plan-comment) is hashContent(plan content); pin via a known content.
    const d = planData("plan body\n"); // v1 content exactly "plan body\n"
    const a = {
      id: "1", type: "plan-comment", component: "01-x", version: 1,
      planPath: "plans/execution/01-x/v1.md", isDraft: false, scope: "", quote: "q",
      prefix: "", suffix: "", sectionHeading: "", occurrenceIndex: 0, anchored: true,
      comment: "c",
    } as const;
    // pinned via `python3 -c "…; print(board.fnv1a_hex('plan body\n'))"` — same
    // literal is asserted in TestPullStaleness.test_fnv1a_matches_client_hashcontent.
    expect(targetHash(d, a)).toBe("723e3740");
  });
});

describe("failed-post keeps pending", () => {
  it("removes on ok, keeps on failure", () => {
    const pending: Annotation[] = [planComment(), { ...planComment(), id: "n2" }];
    expect(applyPostResult(pending, "n1", true).map((a) => a.id)).toEqual(["n2"]);
    expect(applyPostResult(pending, "n1", false).map((a) => a.id)).toEqual(["n1", "n2"]);
  });

  it("clears one pending annotation after an identical lost-response retry", async () => {
    const annotation = planComment();
    const commentId = "11111111-1111-4111-8111-111111111111";
    const body = {
      ...buildCommentBody(annotation, boardWith("original"), "Ada", "cl1"),
      id: commentId,
    };
    const stored = new Map<string, string>();
    let pending: Annotation[] = [annotation];

    async function post(loseResponse: boolean): Promise<boolean> {
      const serialized = JSON.stringify(body);
      const existing = stored.get(body.id);
      if (existing === undefined) stored.set(body.id, serialized);
      if (loseResponse) throw new Error("response lost after store");
      return existing === undefined || existing === serialized;
    }

    try {
      await post(true);
    } catch {
      pending = applyPostResult(pending, annotation.id, false);
    }
    expect(pending.map((a) => a.id)).toEqual([annotation.id]);

    pending = applyPostResult(pending, annotation.id, await post(false));
    expect(stored.size).toBe(1);
    expect([...stored.keys()]).toEqual([commentId]);
    expect(pending).toEqual([]);
  });
});

describe("buildCommentBody", () => {
  it("carries id/clientId/author/shareHash/docHash and the annotation", () => {
    const data = boardWith("original");
    const body = buildCommentBody(planComment(), data, "Ada", "cl1") as Record<string, unknown>;
    expect(body.author).toBe("Ada");
    expect(body.clientId).toBe("cl1");
    expect(body.shareHash).toBe("board-hash-1");
    expect(typeof body.id).toBe("string");
    expect((body.annotation as Annotation).type).toBe("plan-comment");
  });
});
