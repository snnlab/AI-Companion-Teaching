import { useEffect, useMemo, useState } from "react";
import Markdown from "../components/Markdown";
import AnnotationLayer, {
  GeneralCommentBox,
  type AnchoredSelection,
} from "../components/AnnotationLayer";
import {
  parseDecisionLog,
  parseExecutionPlan,
  parseHistory,
  parseScorecard,
} from "../lib/parse";
import { computeAuthorshipPattern, describeAuthorshipPattern } from "../lib/authorship";
import type { OutlineEntry } from "../lib/outline";
import type { ActiveFileRef } from "../lib/filesTree";
import { isScoredScorecard } from "../lib/types";
import type { Annotation, BoardData, DocCommentAnnotation } from "../lib/types";

type EventKind = "decision" | "plan" | "result" | "review" | "reconstructed";

interface TimelineEvent {
  kind: EventKind;
  sortKey: string; // ISO-ish, sortable
  title: string;
  badge?: string;
  body: string; // markdown
  searchText: string;
}

const KIND_STYLE: Record<EventKind, { dot: string; label: string }> = {
  decision: { dot: "bg-blue-500", label: "Decision" },
  plan: { dot: "bg-stone-800", label: "Plan version" },
  result: { dot: "bg-emerald-500", label: "Output" },
  review: { dot: "bg-purple-500", label: "Review" },
  // Reconstructed pre-adoption history: hollow amber dot, dashed card — a record,
  // not a real-time log entry, and visibly so.
  reconstructed: { dot: "border-2 border-amber-400 bg-white dark:bg-stone-900", label: "Reconstructed (pre-adoption)" },
};

export default function Timeline({
  data,
  canAnnotate,
  annotations,
  onAddDocComment,
  onPaintResult,
  onAddGeneral,
  navRequest,
  onOutline,
  onActiveFile,
}: {
  data: BoardData;
  canAnnotate: boolean;
  annotations: Annotation[];
  onAddDocComment: (a: Omit<DocCommentAnnotation, "id" | "type">) => void;
  onPaintResult: (
    painted: Set<string>,
    docKey: string,
    scopeAbsent: Set<string>,
  ) => void;
  onAddGeneral: (view: string, comment: string, category?: "integrity") => void;
  navRequest?: { token: number; clearFilter?: boolean } | null;
  onOutline?: (entries: OutlineEntry[]) => void;
  onActiveFile?: (ref: ActiveFileRef | null) => void;
}) {
  const events = useMemo(() => buildEvents(data), [data]);
  // Authorship-pattern summary (instructor-facing, Phase 1): a neutral,
  // descriptive clue about WHEN the decision log was written — never a
  // pass/fail signal, so it never colors or blocks anything.
  const authorship = useMemo(() => {
    const entries = parseDecisionLog(data.files.decisionLog.content);
    const signedOffLines = data.files.executionPlans.flatMap((g) =>
      g.versions.map((v) => parseExecutionPlan(v.content).signedOff),
    );
    return computeAuthorshipPattern(entries, signedOffLines);
  }, [data]);
  const [filter, setFilter] = useState<EventKind | "all">("all");
  const [query, setQuery] = useState("");
  // Click-sync: a filtered/searched timeline can hide the target event —
  // clear BOTH before scrolling to it.
  useEffect(() => {
    if (!navRequest?.clearFilter) return;
    setFilter("all");
    setQuery("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRequest?.token]);

  const outlineEntries = useMemo<OutlineEntry[]>(
    () =>
      events
        .filter(
          (e) =>
            (filter === "all" || e.kind === filter) &&
            (!query || e.searchText.toLowerCase().includes(query.toLowerCase())),
        )
        .map((e, i) => ({
          // Index-keyed: `kind + sortKey` collides for same-date events (reviews
          // are dated `date + " 00:00"`; the dev fixture has 3 on 2026-07-02).
          id: `timeline-evt-${i}`,
          label: e.title,
          level: 1,
          onSelect: () =>
            document
              .getElementById(`timeline-evt-${i}`)
              ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        })),
    [events, filter, query],
  );
  useEffect(() => {
    onOutline?.(outlineEntries);
    return () => onOutline?.([]);
  }, [onOutline, outlineEntries]);
  useEffect(() => {
    onActiveFile?.({ id: "decision-log", label: "Decision log" });
    return () => onActiveFile?.(null);
  }, [onActiveFile]);

  const visible = events.filter((e) => {
    if (filter !== "all" && e.kind !== filter) return false;
    if (query && !e.searchText.toLowerCase().includes(query.toLowerCase()))
      return false;
    return true;
  });

  const docAnnotations = annotations.filter(
    (a): a is DocCommentAnnotation =>
      a.type === "doc-comment" && a.docKey === "timeline",
  );
  const addComment = (partial: AnchoredSelection) =>
    onAddDocComment({ ...partial, view: "timeline", docKey: "timeline" });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["all", "decision", "plan", "result", "review"] as const).map((k) => (
          <button
            key={k}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              filter === k
                ? "border-stone-900 bg-stone-900 dark:bg-stone-200 text-white dark:text-stone-900"
                : "border-stone-300 dark:border-stone-600 bg-white text-stone-600 hover:border-stone-500 dark:hover:border-stone-400"
            }`}
            onClick={() => setFilter(k)}
          >
            {k === "all" ? "All" : KIND_STYLE[k].label + "s"}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="ml-auto w-52 rounded-md border border-stone-300 dark:border-stone-600 px-2.5 py-1 text-sm outline-none focus:border-stone-500"
        />
      </div>

      {authorship && (
        <div className="mb-4">
          <span
            className="inline-flex items-center gap-1 rounded-full border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/50 px-2 py-0.5 text-[10px] font-medium text-stone-600 dark:text-stone-400"
            title="Decision log authorship pattern — descriptive only, not a verdict. How many distinct days the log was written across, and roughly how long passed between its first entry and the most recent plan sign-off."
          >
            {describeAuthorshipPattern(authorship)}
          </span>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-10 text-center text-sm text-stone-500">
          {events.length === 0
            ? "Nothing logged yet. Entries appear here as decisions happen."
            : "No events match the current filter."}
        </div>
      ) : (
        (() => {
          const list = (
            <ol className="relative ml-2 space-y-4 border-l border-stone-200 dark:border-stone-800 pl-6">
              {visible.map((e, i) => (
                <li key={i} id={`timeline-evt-${i}`} className="relative">
                  <span
                    className={`absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full ${KIND_STYLE[e.kind].dot}`}
                  />
                  <div
                    className={`rounded-lg border p-3 ${
                      e.kind === "reconstructed"
                        ? "border-dashed border-amber-300 bg-amber-50/40"
                        : "border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900"
                    }`}
                    data-annot-scope={`evt:${e.kind}:${e.sortKey}:${e.title}`}
                    data-annot-section={`${KIND_STYLE[e.kind].label} ${e.sortKey.replace(/ 00:00$/, "")}${e.title ? ` — ${e.title}` : ""}`}
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                      <span className="font-medium text-stone-700 dark:text-stone-300">
                        {KIND_STYLE[e.kind].label}
                      </span>
                      <span>{e.sortKey}</span>
                      <span className="font-medium text-stone-700 dark:text-stone-300">{e.title}</span>
                      {e.badge && (
                        <span className="rounded bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                          {e.badge}
                        </span>
                      )}
                    </div>
                    <Markdown source={e.body} className="text-sm" />
                  </div>
                </li>
              ))}
            </ol>
          );
          return (
            <AnnotationLayer
              readOnly={!canAnnotate}
              docKey="timeline"
              annotations={docAnnotations}
              onPaintResult={onPaintResult}
              onAdd={addComment}
            >
              {list}
            </AnnotationLayer>
          );
        })()
      )}

      {canAnnotate && (
        <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
          Select any text to attach a comment.
        </p>
      )}
      {canAnnotate && <GeneralCommentBox view="Timeline" onAdd={onAddGeneral} />}
    </div>
  );
}

function buildEvents(data: BoardData): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Reconstructed pre-adoption history (present only when the project has a
  // history.md). Date-granularity, so it sorts (oldest) to the bottom, before
  // the real-time log — a visibly distinct prelude, never mixed in as fact.
  if (data.files.history) {
    for (const h of parseHistory(data.files.history.content)) {
      events.push({
        kind: "reconstructed",
        sortKey: `${h.sortKey} 00:00`,
        title: h.title,
        badge: "reconstructed",
        body: h.raw,
        searchText: `${h.title} ${h.raw}`,
      });
    }
  }

  for (const entry of parseDecisionLog(data.files.decisionLog.content)) {
    events.push({
      kind: "decision",
      sortKey: entry.timestamp,
      title: "",
      badge: entry.lateCaptured
        ? "late-captured at sync"
        : entry.autoCaptured
          ? "auto-captured"
          : undefined,
      body: entry.raw,
      searchText: entry.raw,
    });
  }

  for (const group of data.files.executionPlans) {
    for (const v of group.versions) {
      const parsed = parseExecutionPlan(v.content);
      const trailerState = v.trailerState ?? parsed.trailerState;
      const gitDate = data.git.fileDates?.[v.path]?.firstCommit;
      const date = parsed.date ?? (gitDate ? gitDate.slice(0, 10) : null);
      events.push({
        kind: "plan",
        sortKey: date ? `${date} 00:00` : "0000-00-00 00:00",
        title: `${group.component} v${v.version}`,
        badge:
          trailerState === "signed"
            ? "signed ✓"
            : trailerState === "amendment"
              ? "amended △"
              : trailerState === "malformed"
                ? "malformed trailer ⚠"
                : undefined,
        body: parsed.supersedes
          ? `**Supersedes:** ${parsed.supersedes}`
          : `Plan v${v.version} committed${parsed.signedOff ? ` — signed off: ${parsed.signedOff}` : ""}.`,
        searchText: `${group.component} v${v.version} ${parsed.supersedes ?? ""}`,
      });
    }
  }

  for (const group of data.files.executionPlans) {
    for (const b of group.results ?? []) {
      const m = b.manifest;
      events.push({
        kind: "result",
        sortKey: m?.capturedAt ?? "0000-00-00 00:00",
        title: `${group.component} r${b.resultsVersion}`,
        badge: m?.provenance === "retrofit" ? "retrofit" : undefined,
        body: `Results captured${m?.planVersion != null ? ` under plan v${m.planVersion}` : ""}${m?.trigger && m.trigger !== "initial" ? ` (${m.trigger})` : ""}${m?.summary ? ` — ${m.summary}` : ""}.`,
        searchText: `results ${group.component} r${b.resultsVersion} ${m?.summary ?? ""}`,
      });
      if (b.verdict) {
        events.push({
          kind: "result",
          sortKey: b.verdict.date,
          title: `${group.component} r${b.resultsVersion}`,
          badge: b.verdict.status,
          body: `Verdict by ${b.verdict.reviewer}: **${b.verdict.status}**${b.verdict.comment ? ` — ${b.verdict.comment}` : ""}.`,
          searchText: `verdict ${group.component} ${b.verdict.status}`,
        });
      }
    }
  }

  for (const r of data.files.reviews) {
    const sc = parseScorecard(r.content);
    if (sc && sc.status === "unscorable") {
      events.push({
        kind: "review",
        sortKey: `${sc.date} 00:00`,
        title: `${sc.component} v${sc.planVersion}`,
        body: `**Unscorable** — ${sc.reason ?? "fix readability first"}.`,
        searchText: `review ${sc.component} unscorable`,
      });
    } else if (isScoredScorecard(sc)) {
      events.push({
        kind: "review",
        sortKey: `${sc.date} 00:00`,
        title: `${sc.component} v${sc.planVersion}`,
        body: `Scored **${sc.profile ?? ""} = ${sc.total}/15**${sc.biggestLeak ? ` — biggest leak: ${sc.biggestLeak.channel}` : ""}.`,
        searchText: `review ${sc.component} ${sc.profile ?? ""}`,
      });
    } else if (sc) {
      // Legacy v1/v2 scorecard — the new profile is unavailable until rescored.
      events.push({
        kind: "review",
        sortKey: `${sc.date} 00:00`,
        title: `${sc.component} v${sc.planVersion}`,
        body: `Legacy review${sc.percent != null ? ` — ${sc.percent}%` : ""}.`,
        searchText: `review ${sc.component} legacy`,
      });
    } else {
      events.push({
        kind: "review",
        sortKey: "0000-00-00 00:00",
        title: r.path,
        body: "Saved review (no scorecard data block).",
        searchText: `review ${r.path}`,
      });
    }
  }

  return events.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
}
