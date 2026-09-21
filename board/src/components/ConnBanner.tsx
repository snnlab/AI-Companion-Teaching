// Live-board connection status (control surface, spec §4). Rendered inside
// the sticky header so the measured panel offset adapts to it.
import type { ConnPhase } from "../lib/reconnect";

export default function ConnBanner({
  phase,
  signSessionEnded = false,
}: {
  phase: ConnPhase;
  signSessionEnded?: boolean;
}) {
  if (phase.kind === "accepted" || phase.kind === "applying") {
    return (
      <div className="border-t border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950 px-5 py-1.5 text-center text-xs text-sky-800 dark:text-sky-300">
        Sent to Claude. A review or report request reopens the board with its
        result; other actions close it — run /aict:board to reopen.
        Reviewer runs can take many minutes.
      </div>
    );
  }
  if (phase.kind === "stalled") {
    return (
      <div className="border-t border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-5 py-1.5 text-center text-xs text-amber-800 dark:text-amber-300">
        Sent to Claude. If this was a review or report it reopens with the
        result; otherwise the board has closed — run /aict:board to
        reopen. Reviewer runs can take many minutes.
      </div>
    );
  }
  if (phase.kind === "sleeping") {
    return (
      <div className="border-t border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 px-5 py-1.5 text-center text-xs text-stone-600 dark:text-stone-300">
        {signSessionEnded
          ? "This sign session has ended — your draft is saved. Run /aict:sign in your session to resume."
          : "Board sleeping — run /aict:board in your session to wake it. Your drafts are safe."}
      </div>
    );
  }
  return null;
}
