// Auto-close after a session-ending action (spec H3, plannotator pattern).
// Default ON; "keep open" cancels and persists per project. Review/report
// requests must never arm this — their relaunch reuses the tab as the new
// board window (board.md relaunches on the same port with --no-open).
import { useCallback, useEffect, useState } from "react";

export type AutoClosePhase =
  | { phase: "idle" }
  | { phase: "counting"; remaining: number }
  | { phase: "closed" }
  | { phase: "closeFailed" }
  | { phase: "cancelled" };

export const AUTO_CLOSE_SECONDS = 3;

export function autoCloseKey(projectKey: string): string {
  return `aict-autoclose:${projectKey}`;
}

function enabled(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "off";
  } catch {
    return true;
  }
}

function tryClose(onFail: () => void): void {
  window.close();
  // window.close() is silently ignored when the browser refuses (multi-entry
  // history, not launcher-opened). Probe survival and fall back to a notice.
  setTimeout(() => {
    if (!window.closed) onFail();
  }, 300);
}

export function useAutoClose(
  active: boolean,
  storageKey: string,
): { state: AutoClosePhase; cancel: () => void; enable: () => void } {
  const [state, setState] = useState<AutoClosePhase>({ phase: "idle" });

  useEffect(() => {
    if (!active) {
      setState({ phase: "idle" });
      return;
    }
    setState(
      enabled(storageKey)
        ? { phase: "counting", remaining: AUTO_CLOSE_SECONDS }
        : { phase: "cancelled" },
    );
  }, [active, storageKey]);

  useEffect(() => {
    if (state.phase !== "counting") return;
    if (state.remaining <= 0) {
      setState({ phase: "closed" });
      tryClose(() => setState({ phase: "closeFailed" }));
      return;
    }
    const t = setTimeout(
      () =>
        setState((prev) =>
          prev.phase === "counting"
            ? { phase: "counting", remaining: prev.remaining - 1 }
            : prev,
        ),
      1000,
    );
    return () => clearTimeout(t);
  }, [state]);

  const cancel = useCallback(() => {
    try {
      localStorage.setItem(storageKey, "off");
    } catch {
      /* ignore */
    }
    setState({ phase: "cancelled" });
  }, [storageKey]);

  const enable = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    setState({ phase: "counting", remaining: AUTO_CLOSE_SECONDS });
  }, [storageKey]);

  return { state, cancel, enable };
}
