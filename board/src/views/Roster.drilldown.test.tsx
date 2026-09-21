// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Roster from "./Roster";
import type { RosterData, StudentSubmissions } from "../lib/rosterTypes";
import type { BoardData } from "../lib/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

function roster(): RosterData {
  return {
    schemaVersion: 1,
    course: { id: "soc-501", instructorName: "Prof. Kim" },
    generatedAt: "2026-08-20T09:00",
    students: [
      {
        studentId: "s-amara",
        displayName: "Amara",
        submissionCount: 1,
        lastSubmission: {
          submittedAt: "2026-08-19T14:30",
          idempotencyKey: "k1",
          integrityStatus: "passed",
        },
      },
    ],
  };
}

function studentBoardData(): BoardData {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-19T14:30",
    mode: "static",
    focus: null,
    project: { name: "Amara's Paper" },
    git: { available: false },
    files: {
      masterPlan: { path: "plans/master-plan.md", content: "# MP" },
      decisionLog: { path: "plans/decision-log.md", content: "# DL" },
      executionPlans: [],
      reviews: [],
    },
  } as BoardData;
}

function submissions(): StudentSubmissions {
  return {
    studentId: "s-amara",
    displayName: "Amara",
    submissions: [
      {
        submittedAt: "2026-08-19T14:30",
        idempotencyKey: "k1",
          integrityStatus: "passed",
        payload: studentBoardData(),
      },
    ],
  };
}

/** One fetch mock covering every endpoint the drilled-in board touches:
 * the roster's own submissions fetch, App's hosted-mode comment fetch, and
 * the SendFeedbackButton's release GET/POST. */
function mockFetch(overrides?: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const custom = overrides?.(url, init);
    if (custom !== undefined) return custom;
    if (url === "/api/submissions/s-amara") {
      return { ok: true, status: 200, json: async () => submissions() };
    }
    if (url.startsWith("/api/comments")) {
      return { ok: true, status: 200, json: async () => ({ comments: [] }) };
    }
    if (url.startsWith("/api/release")) {
      return { ok: true, status: 200, json: async () => ({ releasedAt: null }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

describe("Roster drill-in", () => {
  it("fetches the student's submissions and renders the existing App with the payload", async () => {
    mockFetch();
    render(<Roster data={roster()} />);
    fireEvent.click(screen.getByText("Amara"));
    await waitFor(() => {
      expect(screen.getByText("Amara's Paper")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Tracker" })).toBeTruthy();
  });

  it("renders the drilled-in board in hosted mode so the instructor can comment", async () => {
    const { fn } = mockFetch();
    render(<Roster data={roster()} />);
    fireEvent.click(screen.getByText("Amara"));
    await waitFor(() => {
      expect(screen.getByText("Amara's Paper")).toBeTruthy();
    });
    await waitFor(() => {
      expect(fn.mock.calls.some((c) => String(c[0]).startsWith("/api/comments"))).toBe(true);
    });
    expect(screen.getByRole("button", { name: /Feedback/ })).toBeTruthy();
  });

  it("sends feedback to the student via POST /api/release", async () => {
    const { calls } = mockFetch((url, init) => {
      if (url === "/api/release" && init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ ok: true, releasedAt: "2026-08-20T10:00:00.000Z", by: "Prof. Kim" }) };
      }
      return undefined;
    });
    render(<Roster data={roster()} />);
    fireEvent.click(screen.getByText("Amara"));
    await waitFor(() => screen.getByText("Amara's Paper"));

    const sendBtn = await screen.findByRole("button", { name: "학생에게 피드백 보내기" });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByText(/보냈습니다/)).toBeTruthy();
    });
    const post = calls.find((c) => c.url === "/api/release" && c.init?.method === "POST");
    expect(post).toBeTruthy();
    expect(JSON.parse(String(post!.init!.body))).toMatchObject({ shareHash: "k1", by: "Prof. Kim" });
  });

  it("labels the button as already-sent when a release marker exists", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/release")) {
        return { ok: true, status: 200, json: async () => ({ releasedAt: "2026-08-19T20:00:00.000Z", by: "Prof. Kim" }) };
      }
      return undefined;
    });
    render(<Roster data={roster()} />);
    fireEvent.click(screen.getByText("Amara"));
    await waitFor(() => screen.getByText("Amara's Paper"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "피드백 다시 보내기" })).toBeTruthy();
    });
    expect(screen.getByText(/이미 보냄/)).toBeTruthy();
  });

  it("returns to the roster table via the back affordance", async () => {
    mockFetch();
    render(<Roster data={roster()} />);
    fireEvent.click(screen.getByText("Amara"));
    await waitFor(() => screen.getByText("Amara's Paper"));
    fireEvent.click(screen.getByRole("button", { name: /Back to roster/ }));
    expect(screen.getByPlaceholderText(/Search students by name/)).toBeTruthy();
  });

  it("shows a re-login prompt on a 401 without building its own login form", async () => {
    mockFetch((url) => {
      if (url === "/api/submissions/s-amara") return { ok: false, status: 401, json: async () => ({}) };
      return undefined;
    });
    render(<Roster data={roster()} />);
    fireEvent.click(screen.getByText("Amara"));
    await waitFor(() => {
      expect(screen.getByText(/instructor session has expired/i)).toBeTruthy();
    });
    const link = screen.getByText("Log in again") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/login");
  });
});
