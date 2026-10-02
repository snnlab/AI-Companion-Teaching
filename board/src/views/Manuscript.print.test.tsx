// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Manuscript from "./Manuscript";
import type { Annotation, BoardData } from "../lib/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const noop = () => {};

function data(): BoardData {
  return {
    schemaVersion: 2, generatedAt: "2026-10-02T12:00", mode: "hosted", focus: null,
    project: { name: "studentA-project" }, git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [], reviews: [],
      manuscript: {
        path: "plans/manuscript.docx", format: "docx-html",
        content: "<h1>Paper</h1><p>Panel studies routinely report effects. Later text.</p>",
      },
    },
  } as BoardData;
}

const comments: Annotation[] = [
  {
    id: "c-1", type: "doc-comment", view: "manuscript", docKey: "plans/manuscript.docx",
    scope: "manuscript", quote: "routinely report", prefix: "", suffix: "", sectionHeading: "manuscript",
    occurrenceIndex: 0, anchored: true, comment: "Cite two of them.", author: "Prof. Kim",
  },
  { id: "g-1", type: "general", view: "Manuscript", comment: "Good draft overall." },
];

describe("Manuscript print / save as PDF", () => {
  it("prints a clean copy with numbered highlights and the comment list, then cleans up", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    render(<Manuscript data={data()} canAnnotate={true} annotations={comments}
      onAddDocComment={noop} onPaintResult={noop} onAddGeneral={noop} />);

    expect(screen.getByText("Include comments (2)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Print / Save as PDF" }));
    const root = await screen.findByTestId("print-root");
    expect(root.parentElement).toBe(document.body); // outside the board, so print CSS can isolate it
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(root.querySelector('mark[data-annotation="c-1"]')?.textContent).toBe("routinely report");
    expect(root.querySelector("sup.print-ref")?.textContent).toBe("[1]");
    const list = root.querySelector(".print-comments")!.textContent!;
    expect(list).toContain("[1] Prof. Kim");
    expect(list).toContain("Cite two of them.");
    expect(list).toContain("General comment");
    expect(root.querySelector(".print-sub")?.textContent).toContain("plans/manuscript.docx");

    await act(async () => {
      window.dispatchEvent(new Event("afterprint"));
    });
    await waitFor(() => expect(screen.queryByTestId("print-root")).toBeNull());
  });

  it("prints the text alone when comments are switched off", async () => {
    vi.stubGlobal("print", vi.fn());
    render(<Manuscript data={data()} canAnnotate={true} annotations={comments}
      onAddDocComment={noop} onPaintResult={noop} onAddGeneral={noop} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Print / Save as PDF" }));
    const root = await screen.findByTestId("print-root");
    expect(root.querySelector("mark")).toBeNull();
    expect(root.querySelector(".print-comments")).toBeNull();
    expect(root.textContent).toContain("Panel studies routinely report effects.");
  });
});
