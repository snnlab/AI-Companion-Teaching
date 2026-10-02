// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Manuscript from "./Manuscript";
import type { BoardData, ManuscriptFile } from "../lib/types";
import type { OutlineEntry } from "../lib/outline";

afterEach(cleanup);

function data(manuscript?: ManuscriptFile): BoardData {
  return {
    schemaVersion: 1, generatedAt: "t", mode: "live", focus: null,
    project: { name: "p" }, git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [],
      reviews: [],
      ...(manuscript ? { manuscript } : {}),
    },
  } as BoardData;
}

const noop = () => {};

describe("Manuscript", () => {
  it("shows guidance to write plans/manuscript.md when no manuscript exists", () => {
    render(
      <Manuscript data={data()} canAnnotate={true} annotations={[]}
        onAddDocComment={noop} onPaintResult={noop} onAddGeneral={noop} />,
    );
    expect(screen.getByText("No manuscript yet")).toBeTruthy();
    expect(screen.getByText("plans/manuscript.md")).toBeTruthy();
  });

  it("shows the unsupported-format note instead of content for HWP", () => {
    render(
      <Manuscript
        data={data({
          path: "plans/manuscript.hwp", content: "", format: "unsupported",
          note: "HWP files can't be previewed on the board.",
        })}
        canAnnotate={true} annotations={[]}
        onAddDocComment={noop} onPaintResult={noop} onAddGeneral={noop}
      />,
    );
    expect(screen.getByText(/Can't preview plans\/manuscript\.hwp/)).toBeTruthy();
    expect(screen.getByText("HWP files can't be previewed on the board.")).toBeTruthy();
  });

  it("renders markdown manuscript content and the general-comment affordance", () => {
    render(
      <Manuscript
        data={data({
          path: "plans/manuscript.md",
          content: "# Working title\n\nSome prose.",
          format: "markdown",
        })}
        canAnnotate={true} annotations={[]}
        onAddDocComment={noop} onPaintResult={noop} onAddGeneral={noop}
      />,
    );
    expect(screen.getByText("Working title")).toBeTruthy();
    expect(screen.getByText("+ General comment on this view")).toBeTruthy();
  });

  it("hides the general-comment affordance when canAnnotate is false", () => {
    render(
      <Manuscript
        data={data({ path: "plans/manuscript.md", content: "# T", format: "markdown" })}
        canAnnotate={false} annotations={[]}
        onAddDocComment={noop} onPaintResult={noop} onAddGeneral={noop}
      />,
    );
    expect(screen.queryByText("+ General comment on this view")).toBeNull();
  });

  it("shows a lossy-conversion note for a docx-derived manuscript", () => {
    render(
      <Manuscript
        data={data({
          path: "plans/manuscript.docx",
          content: "Body text.",
          format: "docx-text",
          note: "Converted from Word — formatting, images, and tables are not preserved.",
        })}
        canAnnotate={true} annotations={[]}
        onAddDocComment={noop} onPaintResult={noop} onAddGeneral={noop}
      />,
    );
    expect(screen.getByText(/Converted from Word/)).toBeTruthy();
    expect(screen.getByText("Body text.")).toBeTruthy();
  });

  it("publishes an outline built from the rendered manuscript's headings", () => {
    let published: OutlineEntry[] = [];
    render(
      <Manuscript
        data={data({
          path: "plans/manuscript.md",
          content: "# Title\n\n## Introduction\n\nBody.\n\n## Methods\n\nBody.",
          format: "markdown",
        })}
        canAnnotate={false} annotations={[]}
        onAddDocComment={noop} onPaintResult={noop} onAddGeneral={noop}
        onOutline={(e) => (published = e)}
      />,
    );
    expect(published.map((e) => e.label)).toEqual(["Title", "Introduction", "Methods"]);
  });

  it("publishes no outline when the manuscript is unsupported", () => {
    let published: OutlineEntry[] | null = null;
    render(
      <Manuscript
        data={data({
          path: "plans/manuscript.hwp", content: "", format: "unsupported",
          note: "HWP files can't be previewed on the board.",
        })}
        canAnnotate={false} annotations={[]}
        onAddDocComment={noop} onPaintResult={noop} onAddGeneral={noop}
        onOutline={(e) => (published = e)}
      />,
    );
    expect(published).toEqual([]);
  });
});

describe("Manuscript (Word, docx-html)", () => {
  it("renders the converted HTML and paints a comment across formatting and table cells", async () => {
    const { waitFor } = await import("@testing-library/react");
    const content =
      '<h1>Paper</h1><p>Panel studies <strong>routinely</strong> report effects.</p>' +
      '<div class="tbl"><table><tbody><tr><td class="bt bb">CLPM</td><td class="bt bb ar">0.071</td></tr></tbody></table></div>' +
      '<script>window.__pwned = 1</script>';
    const d = data({ path: "plans/manuscript.docx", content, format: "docx-html" });
    const ann = {
      id: "ann-x", type: "doc-comment" as const, view: "manuscript" as const,
      docKey: "plans/manuscript.docx", scope: "manuscript", quote: "routinely report",
      prefix: "", suffix: "", sectionHeading: "manuscript", occurrenceIndex: 0,
      anchored: true, comment: "c",
    };
    const { container } = render(
      <Manuscript data={d} canAnnotate={true} annotations={[ann]}
        onAddDocComment={noop} onPaintResult={noop} onAddGeneral={noop} />,
    );
    expect(container.querySelector(".prose-md.docx table td.ar")?.textContent).toBe("0.071");
    expect(container.querySelector("script")).toBeNull();
    expect(screen.queryByText(/formatting and tables are not preserved/)).toBeNull();
    await waitFor(() => {
      const marks = container.querySelectorAll('mark[data-annotation="ann-x"]');
      if (marks.length === 0) throw new Error("not painted");
      expect(Array.from(marks, (m) => m.textContent).join("")).toBe("routinely report");
    });
  });
});
