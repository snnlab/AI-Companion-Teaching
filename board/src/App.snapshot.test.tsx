// @vitest-environment jsdom
// The read-only history board: a past submission with the instructor's
// released comments painted in place, and no way to write new ones.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import StudentHistoryApp, { ME_TOKEN_KEY } from "./StudentHistoryApp";
import type { Annotation, BoardData, StoredComment } from "./lib/types";
import { targetHash } from "./lib/hostedComments";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
});

const KEY = "0123456789abcdef";

function payload(): BoardData {
  return {
    schemaVersion: 2, generatedAt: "2026-09-29T23:40", mode: "submission" as BoardData["mode"],
    focus: null, project: { name: "p" }, git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [],
      reviews: [],
      manuscript: {
        path: "plans/manuscript.md",
        content: "# Paper\n\nPanel studies routinely report that SES predicts well-being.",
        format: "markdown",
      },
    },
  } as BoardData;
}

function comment(data: BoardData): StoredComment {
  const annotation: Annotation = {
    id: "ann-1", type: "doc-comment", view: "manuscript", docKey: "plans/manuscript.md",
    scope: "manuscript", quote: "routinely report", prefix: "", suffix: "",
    sectionHeading: "manuscript", occurrenceIndex: 0, anchored: true, comment: "Cite two of them.",
  };
  return {
    id: "11111111-2222-4333-8444-555555555555", clientId: "c", author: "Prof. Kim",
    shareHash: KEY, docHash: targetHash(data, annotation), annotation,
    receivedAt: "2026-10-01T03:00:00.000Z", editedAt: "2026-10-02T03:00:00.000Z",
  };
}

function snapshotData(): BoardData {
  const base = { ...payload(), shareHash: KEY };
  return {
    ...base,
    mode: "snapshot",
    snapshot: { submittedAt: "2026-09-29T23:40:00+09:00", releasedAt: "2026-10-01T04:00:00.000Z", comments: [comment(base)] },
  };
}

async function openManuscriptMark(id: string) {
  fireEvent.click(screen.getByRole("button", { name: "Manuscript" }));
  return waitFor(() => {
    const m = document.querySelector(`mark[data-annotation="${id}"]`);
    if (!m) throw new Error("not painted yet");
    return m as HTMLElement;
  });
}

describe("snapshot (history) board", () => {
  it("paints released comments read-only and offers no way to comment", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const data = snapshotData();
    render(<App data={data} />);
    await act(async () => {});

    expect(screen.getByText(/Read-only copy of your submission/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Instructor comments (1)" })).toBeTruthy();
    expect(screen.queryByText("Send to Claude")).toBeNull();

    const mark = await openManuscriptMark(data.snapshot!.comments[0].id);
    expect(mark.getAttribute("data-kind")).toBe("sent");
    expect(screen.queryByPlaceholderText(/general comment/i)).toBeNull();

    fireEvent.click(mark);
    const dialog = await screen.findByRole("dialog", { name: "Comment" });
    expect(dialog.textContent).toContain("Cite two of them.");
    expect(dialog.textContent).toContain("Edited");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    // never talks to a comments API — the comments came with the snapshot
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("StudentHistoryApp (/me/board)", () => {
  it("asks for the /me token when none is stored", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<StudentHistoryApp />);
    expect(screen.getByText(/Open My feedback first/)).toBeTruthy();
  });

  it("loads the student's released submission with their token and shows it read-only", async () => {
    localStorage.setItem(ME_TOKEN_KEY, "tok-alice");
    const base = { ...payload(), shareHash: KEY };
    const c = comment(base);
    const seen: { url: string; auth?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
      if (url === "/api/my-comments") {
        return {
          ok: true, status: 200,
          json: async () => ({
            studentId: "alice", comments: [c],
            submissions: [
              { shareHash: KEY, submittedAt: "2026-09-29T23:40:00+09:00", releasedAt: "2026-10-01T04:00:00.000Z" },
              { shareHash: "fedcba9876543210", submittedAt: "2026-09-30T10:00:00+09:00", releasedAt: null },
            ],
          }),
        };
      }
      if (url.startsWith("/api/my-submission?")) {
        return {
          ok: true, status: 200,
          json: async () => ({ submittedAt: "2026-09-29T23:40:00+09:00", releasedAt: "2026-10-01T04:00:00.000Z", payload: payload() }),
        };
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch);

    render(<StudentHistoryApp />);
    await screen.findByText(/Read-only copy of your submission/);
    expect(seen.find((s) => s.url.startsWith("/api/my-submission"))?.url).toBe(`/api/my-submission?key=${KEY}`);
    expect(seen.every((s) => s.auth === "Bearer tok-alice")).toBe(true);
    const mark = await openManuscriptMark(c.id);
    fireEvent.click(mark);
    expect((await screen.findByRole("dialog", { name: "Comment" })).textContent).toContain("Cite two of them.");
    expect(new URL(location.href).searchParams.get("key")).toBe(KEY);
  });
});
