import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import RosterApp from "./RosterApp";
import ErrorBoundary from "./components/ErrorBoundary";
import type { BoardData } from "./lib/types";
import "./index.css";

function readSlot(): BoardData | null {
  const el = document.getElementById("board-data");
  const txt = el?.textContent?.trim();
  if (!txt) return null;
  try {
    const parsed = JSON.parse(txt);
    if (parsed && typeof parsed === "object" && parsed.schemaVersion >= 1) {
      return parsed as BoardData;
    }
  } catch {
    // fall through to null
  }
  return null;
}

function NoData() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-800/50">
      <div className="max-w-md rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-stone-800 dark:text-stone-200">
          AICT
        </h1>
        <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
          No project data is injected into this page. This file is a template.
          Generate a real board from your research project with:
        </p>
        <pre className="mt-3 rounded bg-stone-100 dark:bg-stone-800 p-2 text-left text-xs">
          /aict:board
        </pre>
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root")!;

// Classroom roster dashboard (Phase 2, instructor-hosted server): the
// classroom server's own dashboard HTML marks its mount point with
// data-aict-mode="roster" instead of injecting a #board-data payload —
// there is no single embedded project here, so RosterApp fetches RosterData
// live from /api/roster instead. This is the ONLY change this file makes for
// Phase 2: the single-project path below (#board-data / dev-data) is
// untouched and runs exactly as before whenever this attribute is absent.
if (rootEl.dataset.aictMode === "roster") {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <RosterApp />
      </ErrorBoundary>
    </StrictMode>,
  );
} else {
  let data = readSlot();
  if (!data && import.meta.env.DEV) {
    data = (await import("./dev-data")).devData;
  }

  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>{data ? <App data={data} /> : <NoData />}</ErrorBoundary>
    </StrictMode>,
  );
}
