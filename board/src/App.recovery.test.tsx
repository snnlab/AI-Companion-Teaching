// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import type { BoardData } from "./lib/types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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

function signFixture(): BoardData {
  const item = {
    component: "01-alpha", proposedVersion: 1,
    path: "plans/execution/01-alpha/.gate-v1.md",
    content: "# Alpha — Execution Plan v1\n\n## Goal and success criteria\n\ngoal text\n",
    contentHash: "a".repeat(64), ticketed: false,
  };
  return {
    schemaVersion: 2, generatedAt: "2026-07-18T00:00", mode: "live",
    focus: "01-alpha", projectId: "p1", bootId: "b1", boardToken: "token",
    project: { name: "p" }, git: { available: false },
    sign: { batchId: "h1", transport: "hook", items: [item] },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [{ component: "01-alpha", versions: [], draft: item }],
      reviews: [],
    },
  } as BoardData;
}

describe("failed sign-session POST recovery", () => {
  it("routes server-gone recovery through the new ConnBanner copy", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/api/approve")) {
        return { ok: false, status: 403, json: async () => ({ error: "bad-token" }) };
      }
      throw new TypeError("fetch failed");
    }));
    render(<App data={signFixture()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Approve$/ }));
    await waitFor(() => {
      expect(screen.getByText(/This sign session has ended/i)).toBeTruthy();
    });
    expect(screen.getByText(/aict:sign/)).toBeTruthy();
  });
});
