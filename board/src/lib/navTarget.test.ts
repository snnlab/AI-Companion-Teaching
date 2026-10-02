import { describe, it, expect } from "vitest";
import { navTargetFor } from "./navTarget";
import type { Annotation, BoardData } from "./types";

const data = {} as BoardData; // navTargetFor is annotation-driven today

function t(a: Record<string, unknown>) {
  return navTargetFor(a as unknown as Annotation, data);
}

describe("navTargetFor", () => {
  it("manuscript doc comment -> manuscript tab (not the tracker fallback)", () => {
    expect(
      t({
        id: "m1", type: "doc-comment", view: "manuscript",
        docKey: "plans/manuscript.docx", anchored: true,
      }),
    ).toMatchObject({ tab: "manuscript", annotationId: "m1", anchored: true });
  });

  it("plan comment -> plans tab + plan path", () => {
    expect(
      t({
        id: "1", type: "plan-comment", component: "01-x", version: 2,
        planPath: "plans/execution/01-x/.draft-v2.md", anchored: true,
      }),
    ).toMatchObject({
      tab: "plans", component: "01-x",
      planPath: "plans/execution/01-x/.draft-v2.md",
      annotationId: "1", anchored: true,
    });
  });

  it("result comment -> results tab + bundle version", () => {
    expect(
      t({
        id: "2", type: "result-comment", component: "01-x", resultsVersion: 3,
        target: { kind: "artifact", artifactId: "fig1" }, anchored: true,
      }),
    ).toMatchObject({ tab: "results", resultsVersion: 3, scriptPath: undefined });
  });

  it("result comment on a provenance script surface opens the script", () => {
    expect(
      t({
        id: "3", type: "result-comment", component: "01-x", resultsVersion: 3,
        target: {
          kind: "report", quote: "q", occurrenceIndex: 0,
          surfaceScope: "provenance-script:scripts/fit.R",
        },
      }),
    ).toMatchObject({ scriptPath: "scripts/fit.R" });
  });

  it("script comment -> results + open script", () => {
    expect(
      t({
        id: "4", type: "script-comment", component: "01-x", resultsVersion: 1,
        script: "scripts/clean.py", lineStart: 3, lineEnd: 5,
      }),
    ).toMatchObject({
      tab: "results", scriptPath: "scripts/clean.py", anchored: true,
    });
  });

  it("timeline doc comment clears the filter", () => {
    expect(
      t({
        id: "5", type: "doc-comment", view: "timeline", docKey: "timeline",
        anchored: true,
      }),
    ).toMatchObject({ tab: "timeline", clearTimelineFilter: true });
  });

  it("archive doc comment strips the docKey prefix", () => {
    expect(
      t({
        id: "6", type: "doc-comment", view: "archive",
        docKey: "archive:plans/archive/2026-07-01-master-plan.md",
        anchored: false,
      }),
    ).toMatchObject({
      tab: "archive",
      archivePath: "plans/archive/2026-07-01-master-plan.md",
      anchored: false,
    });
  });

  it("reports doc-comment navigates to the reports tab with component + bundle", () => {
    expect(
      t({
        id: "1", type: "doc-comment", view: "reports",
        docKey: "plans/reports/05-hetero-r3-report.md", scope: "", quote: "q", prefix: "",
        suffix: "", sectionHeading: "", occurrenceIndex: 0, anchored: true, comment: "c",
      }),
    ).toMatchObject({ tab: "reports", component: "05-hetero", resultsVersion: 3 });
  });

  it("a stale reviews doc comment (tab removed) falls back to the tracker", () => {
    // The Reviews tab was removed in v0.4 (scores moved to the plan header); a
    // stored review-scoped comment must degrade safely, not crash.
    expect(
      t({
        id: "7", type: "doc-comment", view: "reviews",
        docKey: "plans/reviews/review-01.md", anchored: true,
      }),
    ).toMatchObject({ tab: "tracker" });
  });

  it("general comments navigate without a highlight", () => {
    expect(t({ id: "8", type: "general", view: "tracker", comment: "c" }))
      .toMatchObject({ tab: "tracker", anchored: false });
  });
});
