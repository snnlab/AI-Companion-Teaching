// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Reports from "./Reports";
import type { BoardData, ResultsBundle } from "../lib/types";

afterEach(cleanup);

const MARKER = '<!-- aict-report {"schemaVersion": 1, "component": "01-x", "bundle": 1, "plan": 1, "verdict": "pending", "generated": "2026-07-10T14:30"} -->';
const V2_MARKER = '<!-- aict-report {"schemaVersion": 2, "component": "01-x", "bundle": 1, "plan": 1, "validation": "conforms", "generated": "2026-07-17T10:00"} -->';

function bundle(over: Partial<ResultsBundle>): ResultsBundle {
  return {
    resultsVersion: 1, dir: "plans/execution/01-x/results/r1",
    manifest: { schemaVersion: 1, component: "01-x", resultsVersion: 1, planVersion: 1,
      provenance: "planned", trigger: "initial", capturedAt: "t",
      // a substantive finding by default → report-able (see null-result tests below)
      metrics: [{ label: "Effect", value: "0.3", status: "robust" }], artifacts: [] },
    manifestRaw: { path: "plans/execution/01-x/results/r1/manifest.json", content: "{}" },
    report: null, verdict: null, verdictRaw: null, scripts: [],
    assets: { "fig1.png": "data:image/png;base64,AAAA" },
    publishedReport: {
      path: "plans/reports/01-x-r1-report.md",
      content: `${MARKER}\n# Report\n\n![Fig](../execution/01-x/results/r1/artifacts/fig1.png)\n`,
    },
    reportFormats: { pdf: true, docx: false },
    ...over,
  };
}

function data(bundles: ResultsBundle[], mode: BoardData["mode"] = "live"): BoardData {
  return {
    schemaVersion: 1, generatedAt: "t", mode, focus: null,
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
function draw(d: BoardData, over: Record<string, unknown> = {}) {
  return render(
    <Reports data={d} canAnnotate={false} selectedComponent="01-x"
      annotations={[]} onAddDocComment={noop}
      onPaintResult={noop} focusResults={null} navRequest={null} {...over} />,
  );
}

describe("Reports view", () => {
  it("caps the report reading card at 52rem", () => {
    draw(data([bundle({})]));
    expect(screen.getByText("Report").closest("section")?.classList.contains("max-w-[52rem]")).toBe(true);
  });

  it("renders the report body with the marker stripped and figures resolved", () => {
    const { container } = draw(data([bundle({})]));
    expect(screen.getByText("Report")).toBeTruthy();
    expect(container.textContent).not.toContain("aict-report");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });
  it("labels the bundle picker rN · plan vN", () => {
    draw(data([bundle({})]));
    expect(screen.getByText(/r1 · plan v1/)).toBeTruthy();
  });
  it("flags a report whose marker verdict predates the current verdict", () => {
    const b = bundle({ verdict: { status: "accepted", date: "t", planVersion: 1, reviewer: "BK" } as never });
    draw(data([b]));
    expect(screen.getByText(/generated before the current verdict/i)).toBeTruthy();
  });
  it("flags a v2 marker whose validation differs from the bundle", () => {
    const b = bundle({
      manifest: { schemaVersion: 1, component: "01-x", resultsVersion: 1, planVersion: 1,
        provenance: "planned", trigger: "initial", capturedAt: "t", metrics: [], artifacts: [],
        validation: { status: "skipped", validator: "test" } },
      publishedReport: { path: "plans/reports/01-x-r1-report.md", content: `${V2_MARKER}\nB\n` },
    });
    draw(data([b]));
    expect(screen.getByText(/it says “conforms”, the bundle is “skipped”/i)).toBeTruthy();
  });
  it("does not flag a v2 marker matching the bundle validation", () => {
    const b = bundle({
      manifest: { schemaVersion: 1, component: "01-x", resultsVersion: 1, planVersion: 1,
        provenance: "planned", trigger: "initial", capturedAt: "t", metrics: [], artifacts: [],
        validation: { status: "conforms", validator: "test" } },
      publishedReport: { path: "plans/reports/01-x-r1-report.md", content: `${V2_MARKER}\nB\n` },
    });
    draw(data([b]));
    expect(screen.queryByText(/current validation/i)).toBeNull();
  });
  it("flags a marker naming a different bundle as wrong file", () => {
    const wrong = MARKER.replace('"bundle": 1', '"bundle": 9');
    const b = bundle({ publishedReport: { path: "plans/reports/01-x-r1-report.md", content: `${wrong}\nB\n` } });
    draw(data([b]));
    expect(screen.getByText(/wrong file/i)).toBeTruthy();
  });
  it("soft-flags a marker-less legacy report and still renders it", () => {
    const b = bundle({ publishedReport: { path: "plans/reports/01-x-r1-report.md", content: "# Legacy\n" } });
    draw(data([b]));
    expect(screen.getByText("Legacy")).toBeTruthy();
    expect(screen.getByText(/before verdict tracking/i)).toBeTruthy();
  });
  it("malformed marker: body still renders with a soft flag", () => {
    const b = bundle({ publishedReport: { path: "plans/reports/01-x-r1-report.md", content: '<!-- aict-report {"broken":\n# Body\n' } });
    draw(data([b]));
    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.getByText(/marker unreadable/i)).toBeTruthy();
  });
  it("empty state without a report offers Generate report when actions available", () => {
    const b = bundle({ publishedReport: null, reportFormats: { pdf: false, docx: false } });
    draw(data([b]), { onRequestReport: vi.fn() });
    expect(screen.getByText(/No report generated/i)).toBeTruthy();
    expect(screen.getByText("Generate report")).toBeTruthy();
  });
  it("empty state notes orphaned pdf/docx", () => {
    const b = bundle({ publishedReport: null, reportFormats: { pdf: true, docx: false } });
    draw(data([b]));
    expect(screen.getByText(/markdown is missing/i)).toBeTruthy();
  });
  it("null-result: a bundle with no substantive findings shows the no-result state and no Generate button", () => {
    const b = bundle({
      publishedReport: null, reportFormats: { pdf: false, docx: false },
      manifest: { schemaVersion: 1, component: "01-x", resultsVersion: 1, planVersion: 1,
        provenance: "planned", trigger: "initial", capturedAt: "t",
        metrics: [{ label: "N", value: "1234", status: "descriptive" }], artifacts: [] },
    });
    draw(data([b]), { onRequestReport: vi.fn() });
    expect(screen.getByText(/No report — no substantive findings/i)).toBeTruthy();
    expect(screen.queryByText("Generate report")).toBeNull();
  });
  it("null-result: no newer-bundle 'generate' nudge for a substantive-less latest bundle", () => {
    const b2 = bundle({ resultsVersion: 2, dir: "plans/execution/01-x/results/r2",
      publishedReport: null, reportFormats: { pdf: false, docx: false },
      manifest: { schemaVersion: 1, component: "01-x", resultsVersion: 2, planVersion: 1,
        provenance: "planned", trigger: "initial", capturedAt: "t",
        metrics: [{ label: "N", value: "5", status: "descriptive" }], artifacts: [] } });
    // view r1 (which has a report); r2 is the substantive-less latest
    draw(data([bundle({}), b2]), { navRequest: { token: 1, resultsVersion: 1 }, onRequestReport: vi.fn() });
    expect(screen.queryByText(/has no report yet — generate one/i)).toBeNull();
  });
  it("newer-bundle flag names the latest rN lacking a report and carries a Generate button targeting it", () => {
    const b2 = bundle({ resultsVersion: 2, dir: "plans/execution/01-x/results/r2",
      publishedReport: null, reportFormats: { pdf: false, docx: false } });
    const onRequestReport = vi.fn();
    draw(data([bundle({}), b2]), { navRequest: { token: 1, resultsVersion: 1 }, onRequestReport });
    const flagText = screen.getByText(/r2 .*no report/i);
    expect(flagText).toBeTruthy();
    const flagBox = flagText.closest("div.rounded-lg") as HTMLElement;
    const flagButton = flagBox.querySelector("button") as HTMLButtonElement;
    expect(flagButton?.textContent).toBe("Generate report");
    fireEvent.click(flagButton);
    expect(onRequestReport).toHaveBeenCalledWith({ component: "01-x", resultsVersion: 2 });
  });
  it("viewing the report-less latest shows only the empty state, not the newer-bundle flag", () => {
    const b2 = bundle({ resultsVersion: 2, dir: "plans/execution/01-x/results/r2",
      publishedReport: null, reportFormats: { pdf: false, docx: false } });
    draw(data([bundle({}), b2])); // no navRequest -> defaults to viewing the latest, r2
    expect(screen.getByText(/No report generated for r2/i)).toBeTruthy();
    expect(screen.queryByText(/has no report yet — generate one/i)).toBeNull();
  });
  it("downloads: live shows buttons for existing formats; static shows the repo note", () => {
    draw(data([bundle({})], "live"));
    expect(screen.getByText(/download pdf/i)).toBeTruthy();
    cleanup();
    draw(data([bundle({})], "static"));
    expect(screen.queryByText(/download pdf/i)).toBeNull();
    expect(screen.getByText(/plans\/reports\//)).toBeTruthy();
  });
  it("top-level empty state when no component has bundles", () => {
    draw(data([]));
    expect(screen.getByText(/No reports yet/i)).toBeTruthy();
  });
});
