import { fmtDate } from "../lib/fmtDate";
import type { SnapshotInfo, SubmitReceipt } from "../lib/types";

// The banner on the copy /ait:submit opens right after sending: which
// submission this is, and which manuscript file and plan versions went in —
// so a stale manuscript is caught by looking, not by luck.
export default function SubmitReceiptBanner({
  snapshot,
  receipt,
}: {
  snapshot: SnapshotInfo;
  receipt: SubmitReceipt;
}) {
  const id = receipt.submissionId ?? "?";
  const versions = (prefix: string, rows: { component: string; versions: number[] }[]) =>
    rows
      .filter((r) => r.versions.length > 0)
      .map((r) => `${r.component} ${r.versions.map((v) => prefix + v).join(", ")}`)
      .join(" · ") || "none";
  return (
    <div
      className="border-t border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 px-5 py-2 text-xs leading-relaxed text-emerald-950 dark:text-emerald-100"
      data-testid="submit-receipt"
    >
      <p className="font-medium">
        {receipt.status === "replay"
          ? `Nothing new was sent — your instructor already has this exact content (submission ${id}).`
          : `Sent to your instructor — submission ${id}, ${fmtDate(snapshot.submittedAt)}.`}{" "}
        This page is exactly what they see. Check it, especially the Manuscript tab.
      </p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-emerald-800 dark:text-emerald-300">Manuscript</dt>
        <dd className="min-w-0 break-words">
          {receipt.manuscript ? (
            <>
              <code>{receipt.manuscript.path}</code>
              {receipt.manuscript.modifiedAt
                ? ` · saved ${fmtDate(receipt.manuscript.modifiedAt)}`
                : ""}
            </>
          ) : (
            "none sent"
          )}
        </dd>
        <dt className="text-emerald-800 dark:text-emerald-300">Plans</dt>
        <dd className="min-w-0 break-words">{versions("v", receipt.plans)}</dd>
        <dt className="text-emerald-800 dark:text-emerald-300">Results</dt>
        <dd className="min-w-0 break-words">{versions("r", receipt.results)}</dd>
      </dl>
    </div>
  );
}
