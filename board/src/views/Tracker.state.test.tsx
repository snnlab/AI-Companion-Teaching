// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Tracker from "./Tracker";
import type {
  BoardData,
  ResultsBundle,
  TrackerStatus,
  ValidationBlock,
} from "../lib/types";

afterEach(cleanup);

function bundle(
  validation: ValidationBlock["status"] | null,
  legacyAccepted = false,
): ResultsBundle {
  return {
    resultsVersion: 1,
    dir: "plans/execution/01-x/results/r1",
    manifest: {
      schemaVersion: 1,
      component: "01-x",
      resultsVersion: 1,
      planVersion: 1,
      provenance: "planned",
      trigger: "initial",
      capturedAt: "t",
      metrics: [],
      artifacts: [],
      ...(validation
        ? { validation: { status: validation, steps: [], criteria: [] } }
        : {}),
    },
    manifestRaw: { path: "manifest.json", content: "{}" },
    report: null,
    verdict: legacyAccepted
      ? {
          status: "accepted",
          date: "t",
          planVersion: 1,
          reviewer: "BK",
        }
      : null,
    verdictRaw: null,
    scripts: [],
    assets: {},
    publishedReport: null,
  };
}

function data(status: TrackerStatus, result: ResultsBundle): BoardData {
  return {
    schemaVersion: 1,
    generatedAt: "t",
    mode: "live",
    focus: null,
    project: { name: "p" },
    git: { available: false },
    files: {
      masterPlan: {
        path: "plans/master-plan.md",
        content:
          "# T\n\n## Components\n\n" +
          "| # | Component | Status | Execution plan | Outcome / notes | Serves |\n" +
          "|---|---|---|---|---|---|\n" +
          `| 1 | X | ${status} | [v1](execution/01-x/v1.md) | — | — |\n`,
      },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [
        {
          component: "01-x",
          versions: [
            {
              version: 1,
              path: "plans/execution/01-x/v1.md",
              content: "# v1\n\n---\nSigned off: 2026-07-17\n",
            },
          ],
          results: [result],
        },
      ],
      reviews: [],
    },
  } as BoardData;
}

const noop = () => {};
function renderTracker(status: TrackerStatus, result: ResultsBundle) {
  return render(
    <Tracker
      data={data(status, result)}
      canAnnotate={false}
      annotations={[]}
      onAddDocComment={noop}
      onPaintResult={noop}
      onOpenComponent={noop}
      onOpenResults={noop}
      onAddGeneral={noop}
    />,
  );
}

describe("Tracker validation-keyed state", () => {
  it("does not flag an amendment as missing sign-off and badges it amended", () => {
    const fixture = data("in progress", bundle("conforms"));
    const latest = fixture.files.executionPlans[0].versions[0];
    latest.content = "# v1\n\nAmendment recorded, 2026-07-18\n";
    latest.trailerState = "amendment";
    render(
      <Tracker
        data={fixture}
        canAnnotate={false}
        annotations={[]}
        onAddDocComment={noop}
        onPaintResult={noop}
        onOpenComponent={noop}
        onOpenResults={noop}
        onAddGeneral={noop}
      />,
    );
    expect(screen.queryByText(/01-x v1 has no sign-off line/)).toBeNull();
    expect(screen.getByText("amended △")).toBeTruthy();
  });

  it("warns and badges a malformed trailer without calling it signed", () => {
    const fixture = data("in progress", bundle("conforms"));
    const latest = fixture.files.executionPlans[0].versions[0];
    latest.content = "# v1\n\nSigned off: BK, 2026-07-18\n\nordinary line\n";
    latest.trailerState = "malformed";
    render(
      <Tracker
        data={fixture}
        canAnnotate={false}
        annotations={[]}
        onAddDocComment={noop}
        onPaintResult={noop}
        onOpenComponent={noop}
        onOpenResults={noop}
        onAddGeneral={noop}
      />,
    );
    expect(screen.getByText(/01-x v1 has no sign-off line/)).toBeTruthy();
    expect(screen.getByText("malformed trailer ⚠")).toBeTruthy();
    expect(screen.queryByText("signed ✓")).toBeNull();
  });

  it("labels the results column Output", () => {
    renderTracker("in progress", bundle("conforms"));
    expect(screen.getByRole("columnheader", { name: "Output" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Results" })).toBeNull();
  });

  it("does not warn when a done row has a conforming latest bundle", () => {
    renderTracker("done", bundle("conforms"));
    expect(screen.queryByText(/X is done but results r1/)).toBeNull();
  });

  it("warns when a done row has an unvalidated latest bundle", () => {
    renderTracker("done", bundle(null));
    expect(
      screen.getByText("X is done but results r1 are unvalidated"),
    ).toBeTruthy();
  });

  it("warns when done (validated) disagrees with bundle state", () => {
    renderTracker("done (validated)", bundle(null));
    expect(
      screen.getByText(
        "X is marked done (validated) but r1 is unvalidated",
      ),
    ).toBeTruthy();
  });

  it("uses validation marks with a legacy verdict fallback", () => {
    const cases: Array<[ResultsBundle, RegExp]> = [
      [bundle("conforms"), /r1 ✓/],
      [bundle("deviations-found"), /r1 ✕/],
      [bundle(null, true), /r1 ✓/],
    ];
    for (const [result, name] of cases) {
      const { unmount } = renderTracker("in progress", result);
      expect(screen.getByRole("button", { name })).toBeTruthy();
      unmount();
    }
  });
});
