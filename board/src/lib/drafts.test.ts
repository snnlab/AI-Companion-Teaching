import { describe, it, expect } from "vitest";
import type { Annotation } from "./types";
import {
  liveDraftKey,
  draftSuffixKey,
  loadDrafts,
  clearSubmitted,
  type StorageLike,
} from "./drafts";

function fakeStorage(): StorageLike & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

function ann(id: string): Annotation {
  return {
    id,
    type: "general",
    view: "tracker",
    comment: `c-${id}`,
    createdAt: "2026-07-10",
  } as unknown as Annotation;
}

const PID = "abc123";

describe("live draft storage", () => {
  it("fresh project loads empty", () => {
    const s = fakeStorage();
    expect(loadDrafts(s, PID)).toEqual([]);
  });

  it("loads whatever is under the stable live key", () => {
    const s = fakeStorage();
    s.setItem(liveDraftKey(PID), JSON.stringify([ann("a"), ann("b")]));
    const drafts = loadDrafts(s, PID);
    expect(drafts.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("draftSuffixKey composes a suffixed key off any base", () => {
    expect(draftSuffixKey(liveDraftKey(PID), "seeded")).toBe(
      `aict-board:${PID}:live:seeded`,
    );
  });

  it("clearSubmitted removes only the given ids", () => {
    const s = fakeStorage();
    s.setItem(liveDraftKey(PID), JSON.stringify([ann("a"), ann("b"), ann("c")]));
    clearSubmitted(s, PID, ["a", "c"]);
    const kept = JSON.parse(s.getItem(liveDraftKey(PID)) as string) as Annotation[];
    expect(kept.map((a) => a.id)).toEqual(["b"]);
  });

  it("clearSubmitted removes the key entirely when nothing survives", () => {
    const s = fakeStorage();
    s.setItem(liveDraftKey(PID), JSON.stringify([ann("a")]));
    clearSubmitted(s, PID, ["a"]);
    expect(s.getItem(liveDraftKey(PID))).toBeNull();
  });
});
