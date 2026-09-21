import { useCallback, useEffect, useState } from "react";
import Roster from "./views/Roster";
import ThemeToggle from "./components/ThemeToggle";
import type { RosterFetchState } from "./lib/rosterTypes";

/** Top-level bootstrap for the instructor-hosted classroom dashboard (Phase
 * 2) — the "many students" counterpart to App.tsx's single-project board.
 * Mounted by main.tsx instead of App when the page's root element carries
 * `data-aict-mode="roster"` (see main.tsx for the exact detection
 * contract and why).
 *
 * This component's whole job is the roster's own async lifecycle: fetch
 * RosterData from /api/roster over the instructor's existing session cookie,
 * and hand it to Roster.tsx once ready. Roster.tsx owns everything past that
 * — sorting, per-student drill-in (its own fetch to /api/submissions/:id),
 * and rendering the existing, unmodified App.tsx for the selected student. */
export default function RosterApp() {
  const [state, setState] = useState<RosterFetchState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/roster", { credentials: "include" });
      if (res.status === 401) {
        // The classroom server's own dashboard page is assumed to gate access
        // before this bundle even loads (see main.tsx's detection contract);
        // this 401 branch covers a session expiring mid-visit. Pointing at
        // /login rather than building a login form here matches the scope
        // note in the design plan — the classroom server owns that page.
        setState({
          status: "error",
          message: "Your instructor session has expired.",
          unauthorized: true,
        });
        return;
      }
      if (!res.ok) {
        setState({ status: "error", message: `Couldn't load the roster (HTTP ${res.status}).` });
        return;
      }
      const data = await res.json();
      setState({ status: "ready", data });
    } catch {
      setState({ status: "error", message: "Couldn't reach the classroom server." });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-950">
        <p className="text-sm text-stone-500 dark:text-stone-400">Loading roster…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-950">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <div className="max-w-md rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-stone-800 dark:text-stone-200">
            {state.unauthorized ? "Please log in" : "Couldn't load the roster"}
          </h1>
          <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">{state.message}</p>
          {state.unauthorized ? (
            <a
              href="/login"
              className="mt-4 inline-block rounded-md bg-stone-900 dark:bg-stone-200 px-3 py-1.5 text-sm font-medium text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400"
            >
              Go to login
            </a>
          ) : (
            <button
              type="button"
              className="mt-4 rounded-md border border-stone-300 dark:border-stone-600 px-3 py-1.5 text-sm font-medium text-stone-700 dark:text-stone-300 hover:border-stone-500 dark:hover:border-stone-400"
              onClick={load}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <header className="sticky top-0 z-30 border-b border-stone-200 dark:border-stone-800 bg-white/90 dark:bg-stone-900/90 backdrop-blur px-5 py-3">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-stone-900 dark:text-stone-100">
              {state.data.course.name ?? state.data.course.id}
            </div>
            <div className="text-[11px] text-stone-400 dark:text-stone-500">
              aict roster · generated {state.data.generatedAt.slice(0, 16)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-stone-300 dark:border-stone-600 px-3 py-1.5 text-sm font-medium text-stone-700 dark:text-stone-300 hover:border-stone-500 dark:hover:border-stone-400"
              onClick={load}
            >
              Refresh
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-5 py-6">
        <Roster data={state.data} />
      </main>
    </div>
  );
}
