import { useState } from "react";
import ModelChip from "./ModelChip";
import { chipClass } from "./scoreChip";
import { isScoredScorecard } from "../lib/types";
import type { Scorecard, ScorecardChannelId } from "../lib/types";

// Fixed channel letters for the profile strip: G · D · S · V · B.
const LETTER: Record<ScorecardChannelId, string> = {
  goal: "G",
  decisions: "D",
  steps: "S",
  validation: "V",
  boundaries: "B",
};

/**
 * The plan-header score: a five-chip profile with evidence on hover, expandable
 * to the full diagnosis. Renders a v3 scored card; an unscorable card shows its
 * reason; a legacy (v1/v2) card shows a "rescore" affordance instead of chips.
 */
export default function ScorePanel({ scorecard }: { scorecard: Scorecard }) {
  const [open, setOpen] = useState(false);

  if (scorecard.status === "unscorable") {
    return (
      <span
        className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
        title={scorecard.reason ?? "unscorable"}
      >
        unscorable
      </span>
    );
  }

  if (!isScoredScorecard(scorecard)) {
    // Legacy v1/v2 card — the new profile is unavailable until it is rescored.
    return (
      <span
        className="rounded border border-stone-300 bg-stone-50 px-2 py-0.5 text-xs text-stone-500 dark:border-stone-600 dark:bg-stone-800"
        title="Scored under an older rubric — rescore this version to see the five-channel profile."
      >
        legacy review
      </span>
    );
  }

  const flags = Array.isArray(scorecard.integrityFlags)
    ? scorecard.integrityFlags
    : [];

  return (
    <span className="relative inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Plan score — click for the full diagnosis"
        className="inline-flex items-center gap-0.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800"
      >
        {scorecard.channels.map((c) => (
          <span
            key={c.id}
            className={`rounded border px-1 py-0.5 text-[11px] font-semibold tabular-nums ${chipClass(c.score)}`}
            title={`${c.name ?? c.id}: ${c.score}/3${c.evidence ? ` — "${c.evidence}"` : ""}${c.justification ? ` · ${c.justification}` : ""}`}
          >
            {LETTER[c.id] ?? "?"}
            {c.score}
          </span>
        ))}
        <span className="ml-0.5 text-[11px] text-stone-500 tabular-nums">
          {scorecard.total}/15
        </span>
      </button>
      {flags.map((f) => (
        <span
          key={f.id}
          className="rounded border border-orange-300 bg-orange-50 px-1 py-0.5 text-[10px] font-medium text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300"
          title={f.note ?? f.id}
        >
          {f.id}
        </span>
      ))}
      {open && <ScoreDetail scorecard={scorecard} onClose={() => setOpen(false)} />}
    </span>
  );
}

function ScoreDetail({
  scorecard,
  onClose,
}: {
  scorecard: Scorecard & { channels: NonNullable<Scorecard["channels"]> };
  onClose: () => void;
}) {
  return (
    <div className="absolute right-0 top-full z-20 mt-1 w-96 max-w-[90vw] rounded-lg border border-stone-200 bg-white p-3 text-left text-xs shadow-lg dark:border-stone-700 dark:bg-stone-900">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold text-stone-700 dark:text-stone-200">
          {scorecard.profile ?? ""} · plan v{scorecard.planVersion}
        </span>
        <span className="flex items-center gap-2">
          {scorecard.modelUsage && (
            <ModelChip usage={scorecard.modelUsage} label="reviewed by" />
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
            aria-label="Close"
          >
            ✕
          </button>
        </span>
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {scorecard.channels.map((c) => (
            <tr key={c.id} className="border-t border-stone-100 dark:border-stone-800 align-top">
              <td className="py-1 pr-2 font-medium text-stone-700 dark:text-stone-300 whitespace-nowrap">
                {c.name ?? c.id}
              </td>
              <td className="py-1 pr-2">
                <span className={`rounded border px-1 text-[11px] font-semibold ${chipClass(c.score)}`}>
                  {c.score}
                </span>
              </td>
              <td className="py-1 text-stone-500">
                {c.evidence ? <span className="italic">"{c.evidence}"</span> : null}
                {c.justification ? <span> — {c.justification}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {scorecard.biggestLeak && (
        <p className="mt-2 text-stone-600 dark:text-stone-400">
          <span className="font-semibold">Biggest leak:</span>{" "}
          {scorecard.biggestLeak.channel}
          {scorecard.biggestLeak.note ? ` — ${scorecard.biggestLeak.note}` : ""}
        </p>
      )}
      {(scorecard.suggestedMoves?.length ?? 0) > 0 && (
        <div className="mt-1">
          <span className="font-semibold text-stone-600 dark:text-stone-400">Suggested moves:</span>
          <ul className="ml-4 list-disc text-stone-500">
            {scorecard.suggestedMoves!.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {(scorecard.unresolvedForks?.length ?? 0) > 0 && (
        <div className="mt-1">
          <span className="font-semibold text-stone-600 dark:text-stone-400">Unresolved forks:</span>
          <ul className="ml-4 list-disc text-stone-500">
            {scorecard.unresolvedForks!.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {scorecard.split && (
        <p className="mt-2 text-stone-500">
          <span className="font-semibold">Split:</span> {scorecard.split.verdict}
          {scorecard.split.detail ? ` — ${scorecard.split.detail}` : ""}
        </p>
      )}
    </div>
  );
}
