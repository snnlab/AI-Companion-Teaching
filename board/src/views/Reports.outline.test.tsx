// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import Reports from "./Reports";
import type { BoardData, ResultsBundle } from "../lib/types";
import type { OutlineEntry } from "../lib/outline";

afterEach(cleanup);

const MARKER = '<!-- aict-report {"schemaVersion": 1, "component": "01-x", "bundle": 1, "plan": 1, "verdict": "pending", "generated": "2026-07-10T14:30"} -->';

function bundle(over: Partial<ResultsBundle>): ResultsBundle {
  return {
    resultsVersion: 1, dir: "plans/execution/01-x/results/r1",
    manifest: { schemaVersion: 1, component: "01-x", resultsVersion: 1, planVersion: 1,
      provenance: "planned", trigger: "initial", capturedAt: "t",
      metrics: [{ label: "Effect", value: "0.3", status: "robust" }], artifacts: [] },
    manifestRaw: { path: "plans/execution/01-x/results/r1/manifest.json", content: "{}" },
    report: null, verdict: null, verdictRaw: null, scripts: [],
    assets: {},
    publishedReport: {
      path: "plans/reports/01-x-r1-report.md",
      content: `${MARKER}\n## Findings\n\nSomething happened.\n\n## Limitations\n\nSome caveat.\n`,
    },
    reportFormats: { pdf: false, docx: false },
    ...over,
  };
}

function data(bundles: ResultsBundle[]): BoardData {
  return {
    schemaVersion: 1, generatedAt: "t", mode: "live", focus: null,
    project: { name: "p" }, git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [{ component: "01-x",
        versions: [{ version: 1, path: "plans/execution/01-x/v1.md", content: "# v1" }],
        results: bundles }],
      reviews: [],
    },
  } as BoardData;
}

const noop = () => {};

it("publishes an outline built from the rendered report's headings", () => {
  let published: OutlineEntry[] = [];
  render(
    <Reports data={data([bundle({})])} canAnnotate={false} selectedComponent="01-x"
      annotations={[]} onAddDocComment={noop}
      onPaintResult={noop} focusResults={null} navRequest={null}
      onOutline={(e) => (published = e)} />,
  );
  expect(published.map((e) => e.label)).toEqual(["Findings", "Limitations"]);
});
