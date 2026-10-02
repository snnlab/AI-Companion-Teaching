// @vitest-environment jsdom
// Word-style highlights: a sent (server) comment stays painted in the text,
// and clicking the highlight opens a balloon with the comment beside it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
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
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

function hostedFixture(): BoardData {
  return {
    schemaVersion: 2, generatedAt: "2026-10-02T00:00", mode: "hosted",
    focus: null, shareHash: "sh1", defaultReviewer: "Prof. Kim",
    project: { name: "p" }, git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [],
      reviews: [],
      manuscript: {
        path: "plans/manuscript.md",
        content: "# Paper\n\nThe panel model controls for stable traits.",
        format: "markdown",
      },
    },
  } as BoardData;
}

function sentComment(data: BoardData): StoredComment {
  const annotation: Annotation = {
    id: "ann-local-1", type: "doc-comment", view: "manuscript",
    docKey: "plans/manuscript.md", scope: "manuscript",
    quote: "controls for stable traits", prefix: "", suffix: "",
    sectionHeading: "manuscript", occurrenceIndex: 0, anchored: true,
    comment: "Say which traits.",
  };
  return {
    id: "11111111-2222-4333-8444-555555555555", clientId: "c", author: "Prof. Kim",
    shareHash: "sh1", docHash: targetHash(data, annotation), annotation,
    receivedAt: "2026-10-02T03:00:00.000Z",
  };
}

describe("sent comment highlights", () => {
  it("paints a server comment as a sent highlight and opens its balloon on click", async () => {
    const data = hostedFixture();
    const c = sentComment(data);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ comments: [c] }),
    })) as unknown as typeof fetch);

    render(<App data={data} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Manuscript" }));

    const mark = await waitFor(() => {
      const m = document.querySelector(`mark[data-annotation="${c.id}"]`);
      if (!m) throw new Error("not painted yet");
      return m as HTMLElement;
    });
    expect(mark.getAttribute("data-kind")).toBe("sent");
    expect(mark.textContent).toBe("controls for stable traits");

    fireEvent.click(mark);
    const dialog = await screen.findByRole("dialog", { name: "Comment" });
    expect(dialog.textContent).toContain("Say which traits.");
    expect(dialog.textContent).toContain("Prof. Kim");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Comment" })).toBeNull());
  });

  it("paints a pending comment as a draft; the balloon edits and deletes it", async () => {
    const data = hostedFixture();
    const pending: Annotation = { ...sentComment(data).annotation, id: "ann-draft-1", comment: "Draft note" };
    localStorage.setItem(`aict-hosted:p:${location.origin}`, JSON.stringify([pending]));
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ comments: [] }),
    })) as unknown as typeof fetch);

    render(<App data={data} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Manuscript" }));
    const find = () => document.querySelector('mark[data-annotation="ann-draft-1"]') as HTMLElement | null;
    const mark = await waitFor(() => {
      const m = find();
      if (!m) throw new Error("not painted yet");
      return m;
    });
    expect(mark.getAttribute("data-kind")).toBe("draft");

    fireEvent.click(mark);
    const dialog = await screen.findByRole("dialog", { name: "Comment" });
    expect(dialog.textContent).toContain("Not saved yet");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = dialog.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Edited note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(dialog.textContent).toContain("Edited note"));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(dialog.textContent).toContain("Delete this comment?");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(find()).toBeNull());
    expect(screen.queryByRole("dialog", { name: "Comment" })).toBeNull();
  });

  it("roster drill-in: the instructor edits and deletes a SENT comment from its balloon", async () => {
    const data = { ...hostedFixture(), rosterDrill: true } as BoardData;
    const c = sentComment(data);
    const calls: { method: string; url: string; body?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body as string | undefined });
      if (method === "PATCH") {
        const { comment } = JSON.parse(init!.body as string);
        return {
          ok: true,
          json: async () => ({
            comment: { ...c, annotation: { ...c.annotation, comment }, editedAt: "2026-10-02T05:00:00.000Z" },
          }),
        };
      }
      if (method === "DELETE") return { ok: true, json: async () => ({ ok: true }) };
      return { ok: true, json: async () => ({ comments: [c] }) };
    }) as unknown as typeof fetch);

    render(<App data={data} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Manuscript" }));
    const find = () => document.querySelector(`mark[data-annotation="${c.id}"]`) as HTMLElement | null;
    const mark = await waitFor(() => {
      const m = find();
      if (!m) throw new Error("not painted yet");
      return m;
    });

    fireEvent.click(mark);
    const dialog = await screen.findByRole("dialog", { name: "Comment" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(dialog.querySelector("textarea")!, { target: { value: "Name the traits." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(dialog.textContent).toContain("Name the traits."));
    expect(dialog.textContent).toContain("Edited");
    const patch = calls.find((x) => x.method === "PATCH")!;
    expect(patch.url).toBe(`/api/comments?shareHash=sh1&id=${c.id}`);
    expect(JSON.parse(patch.body!)).toEqual({ comment: "Name the traits." });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(dialog.textContent).toContain("The student will no longer see it.");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(find()).toBeNull());
    expect(calls.some((x) => x.method === "DELETE" && x.url.includes(c.id))).toBe(true);
  });

  it("a non-roster hosted board shows sent comments read-only", async () => {
    const data = hostedFixture();
    const c = sentComment(data);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ comments: [c] }),
    })) as unknown as typeof fetch);
    render(<App data={data} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Manuscript" }));
    const mark = await waitFor(() => {
      const m = document.querySelector(`mark[data-annotation="${c.id}"]`);
      if (!m) throw new Error("not painted yet");
      return m as HTMLElement;
    });
    fireEvent.click(mark);
    await screen.findByRole("dialog", { name: "Comment" });
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
