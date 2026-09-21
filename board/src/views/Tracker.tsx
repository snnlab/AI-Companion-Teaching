import { useEffect, useMemo } from "react";
import Markdown from "../components/Markdown";
import AnnotationLayer, {
  GeneralCommentBox,
  type AnchoredSelection,
} from "../components/AnnotationLayer";
import ReviewMenu from "../components/ReviewMenu";
import { actionsVisible } from "../lib/actions";
import { hasSubstantiveFindings } from "../lib/findings";
import type { OutlineEntry } from "../lib/outline";
import type { ActiveFileRef } from "../lib/filesTree";
import { bundleState, bundleStateMark } from "../lib/bundleState";
import type {
  Annotation,
  BoardData,
  DocCommentAnnotation,
  ReviewRequest,
  TrackerStatus,
} from "../lib/types";
import {
  parseDecisionLog,
  parseExecutionPlan,
  parseHistory,
  parseMasterPlan,
  parseServes,
  preRenewalSlugs,
  slugFromLink,
  isDoneStatus,
} from "../lib/parse";

const CHIP: Record<TrackerStatus, string> = {
  "not started": "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 border-stone-200 dark:border-stone-800",
  planned: "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900",
  "in progress": "bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-900",
  done: "bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-300 border-green-200 dark:border-green-900",
  "done (verified)": "bg-green-100 dark:bg-green-900/60 text-green-900 dark:text-green-200 border-green-300 dark:border-green-800",
  "done (validated)": "bg-green-100 dark:bg-green-900/60 text-green-900 dark:text-green-200 border-green-300 dark:border-green-800",
  "done (unvalidated)": "bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-300 border-green-200 dark:border-green-900 border-dashed",
  "done (retrofit)": "bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-300 border-green-200 dark:border-green-900 border-dashed",
  dropped: "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900 line-through",
  unknown: "bg-stone-100 dark:bg-stone-800 text-stone-500 border-stone-200 dark:border-stone-800",
};

export default function Tracker({
  data,
  canAnnotate,
  annotations,
  onAddDocComment,
  onPaintResult,
  onOpenComponent,
  onOpenResults,
  onAddGeneral,
  onRequestReview,
  onOpenArchive,
  onOpenReport,
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
  onOpenComponent: (slug: string | null, name: string) => void;
  onOpenResults: (slug: string) => void;
  onAddGeneral: (view: string, comment: string, category?: "integrity") => void;
  onRequestReview?: (req: ReviewRequest) => void;
  onOpenArchive?: () => void;
  onOpenReport?: (slug: string, resultsVersion: number) => void;
  onOutline?: (entries: OutlineEntry[]) => void;
  onActiveFile?: (ref: ActiveFileRef | null) => void;
}) {
  const mp = parseMasterPlan(data.files.masterPlan.content);

  const outlineEntries = useMemo<OutlineEntry[]>(() => {
    const m = parseMasterPlan(data.files.masterPlan.content);
    if (!m.ok) return [];
    return m.components.map((r) => ({
      id: `tracker-row-${r.num}`,
      label: `${r.num}. ${r.component}`,
      level: 1,
      onSelect: () =>
        document
          .getElementById(`tracker-row-${r.num}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    }));
  }, [data.files.masterPlan.content]);
  useEffect(() => {
    onOutline?.(outlineEntries);
    return () => onOutline?.([]);
  }, [onOutline, outlineEntries]);
  useEffect(() => {
    onActiveFile?.({ id: "master-plan", label: "Master plan" });
    return () => onActiveFile?.(null);
  }, [onActiveFile]);

  const docAnnotations = annotations.filter(
    (a): a is DocCommentAnnotation =>
      a.type === "doc-comment" && a.docKey === "tracker",
  );
  const addComment = (partial: AnchoredSelection) =>
    onAddDocComment({ ...partial, view: "tracker", docKey: "tracker" });

  if (!mp.ok) {
    return (
      <div>
        <Notice text="The master plan did not match the expected format — showing it raw." />
        {canAnnotate ? (
          <AnnotationLayer
            docKey="tracker"
            annotations={docAnnotations}
            onPaintResult={onPaintResult}
            onAdd={addComment}
          >
            <Markdown source={mp.raw} />
          </AnnotationLayer>
        ) : (
          <Markdown source={mp.raw} />
        )}
      </div>
    );
  }

  const knownSlugs = new Set(data.files.executionPlans.map((g) => g.component));
  const linkedSlugs = new Set(
    mp.components
      .map((r) => slugFromLink(r.planLink))
      .filter((s): s is string => s !== null),
  );
  // Execution dirs the current tracker does not list: components moved to an
  // archived master plan by a renewal are expected (quiet badge, never Drift);
  // the rest are true orphans (red Drift, as before).
  const preRenewal = preRenewalSlugs(data);
  const orphanGroups = data.files.executionPlans.filter(
    (g) => !linkedSlugs.has(g.component) && !preRenewal.has(g.component),
  );
  const preRenewalGroups = data.files.executionPlans.filter(
    (g) => !linkedSlugs.has(g.component) && preRenewal.has(g.component),
  );

  const counts = mp.components.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const hasRQs = mp.researchQuestions.length > 0;
  // Serves mismatch: the latest execution-plan version declares different RQs
  // than the master row (client has both files; cheap check).
  const planServesBySlug = new Map<string, string[]>();
  for (const g of data.files.executionPlans) {
    const latest = g.versions[g.versions.length - 1];
    if (!latest) continue;
    const parsed = parseExecutionPlan(latest.content);
    if (parsed.serves) {
      planServesBySlug.set(g.component, parseServes(parsed.serves).tokens);
    }
  }
  const servesMismatch = (row: (typeof mp.components)[number]): boolean => {
    const slug = slugFromLink(row.planLink);
    if (!slug || !planServesBySlug.has(slug)) return false;
    const rowTokens = parseServes(row.serves).tokens;
    const planTokens = planServesBySlug.get(slug)!;
    if (rowTokens.length === 0 && planTokens.length === 0) return false;
    return (
      rowTokens.length !== planTokens.length ||
      rowTokens.some((t) => !planTokens.includes(t))
    );
  };

  // Drift & hygiene checks folded in from the retired /status command. Most are
  // computed from the payload already present; the four filesystem/git checks
  // (stale board.html, leftover staging dirs, verified-source drift, 14-day
  // inactivity) use board.py's `drift` payload field plus git.fileDates and are
  // surfaced below (feature #7).
  type Drift = { text: string; slug?: string };
  const drift: Drift[] = [];
  const rqNums = new Set(mp.researchQuestions.map((q) => q.num));
  for (const g of data.files.executionPlans) {
    const latest = g.versions[g.versions.length - 1];
    const trailerState = latest
      ? latest.trailerState ?? parseExecutionPlan(latest.content).trailerState
      : null;
    if (latest && (trailerState === "none" || trailerState === "malformed")) {
      drift.push({
        text: `${g.component} v${latest.version} has no sign-off line`,
        slug: g.component,
      });
    }
  }
  if (
    data.files.executionPlans.length > 0 &&
    parseDecisionLog(data.files.decisionLog.content).length === 0
  ) {
    drift.push({
      text: "Decision log is empty while execution plans exist — a logging gap",
    });
  }
  if (!hasRQs) {
    drift.push({
      text: "Master plan has no Research questions (pre-v0.3) — run /aict:init update mode",
    });
  }
  for (const r of mp.components) {
    const slug = slugFromLink(r.planLink);
    const badRQs = parseServes(r.serves).tokens.filter(
      (t) => !rqNums.has(parseInt(t.replace(/\D/g, ""), 10)),
    );
    if (badRQs.length > 0) {
      drift.push({
        text: `${r.component}: Serves names ${badRQs.join(", ")}, not in the research questions`,
      });
    }
    if (
      (isDoneStatus(r.status) ||
        r.status === "in progress" ||
        r.status === "planned") &&
      !slug
    ) {
      drift.push({
        text: `${r.component} is ${r.status} but carries no execution plan — run /aict:adopt`,
      });
    }
    const g = slug
      ? data.files.executionPlans.find((x) => x.component === slug)
      : null;
    if (g) {
      const latestResult = g.results?.[g.results.length - 1];
      if (isDoneStatus(r.status) && latestResult) {
        const state = bundleState(latestResult);
        const bundleOk = state.kind === "validated" || state.legacyVerdict === "accepted";
        if (r.status === "done (validated)" && !bundleOk) {
          drift.push({
            text: `${r.component} is marked done (validated) but r${latestResult.resultsVersion} is unvalidated`,
            slug: slug ?? undefined,
          });
        } else if (
          (r.status === "done" || r.status === "done (verified)") &&
          !bundleOk
        ) {
          drift.push({
            text: `${r.component} is done but results r${latestResult.resultsVersion} are unvalidated`,
            slug: slug ?? undefined,
          });
        }
      }
      if (latestResult?.manifest?.validation?.status === "deviations-found") {
        drift.push({
          text: `${r.component}: validation found unrecorded deviations in r${latestResult.resultsVersion}`,
          slug: slug ?? undefined,
        });
      }
      const latestV = g.versions[g.versions.length - 1];
      if (r.status === "in progress" && latestV) {
        const prov = parseExecutionPlan(latestV.content).provenance;
        if (prov && /retrospective/i.test(prov)) {
          drift.push({
            text: `${r.component} is in progress but its latest plan is retrospective — write a prospective v${latestV.version + 1}`,
            slug: slug ?? undefined,
          });
        }
      }
    }
  }
  const initialized =
    /^Initialized:\s*(\d{4}-\d{2}-\d{2})/m.exec(mp.raw)?.[1] ?? null;
  if (initialized && data.files.history) {
    for (const h of parseHistory(data.files.history.content)) {
      if (h.sortKey >= initialized) {
        drift.push({
          text: `history.md entry ${h.date} is on/after Initialized (${initialized}) — belongs in the decision log`,
        });
      }
    }
  }

  // Filesystem/git hygiene (feature #7): board.py-provided flags, plus 14-day
  // inactivity computed here from git.fileDates.
  if (data.drift?.staleBoardHtml) {
    drift.push({
      text: "Exported board.html is older than newer files under plans/ — regenerate with /aict:board --export",
    });
  }
  for (const slug of data.drift?.leftoverStaging ?? []) {
    drift.push({
      text: `${slug}: a leftover results/.staging-* dir — resume or remove the interrupted capture`,
      slug,
    });
  }
  for (const slug of data.drift?.sourceDrift ?? []) {
    drift.push({
      text: `${slug}: captured results no longer match the source files on disk (drifted)`,
      slug,
    });
  }
  const genMs = data.generatedAt ? Date.parse(data.generatedAt) : NaN;
  const fileDates = data.git?.fileDates ?? {};
  if (data.git?.available && !Number.isNaN(genMs)) {
    for (const r of mp.components) {
      if (r.status !== "in progress") continue;
      const slug = slugFromLink(r.planLink);
      const g = slug
        ? data.files.executionPlans.find((x) => x.component === slug)
        : null;
      if (!g) continue;
      let last = 0;
      for (const f of [...g.versions, ...(g.draftSnapshots ?? [])]) {
        const d = fileDates[f.path]?.lastCommit;
        if (d) last = Math.max(last, Date.parse(d));
      }
      if (last > 0 && genMs - last > 14 * 24 * 3600 * 1000) {
        drift.push({
          text: `${r.component} is in progress but has had no git activity in 14+ days`,
          slug: slug ?? undefined,
        });
      }
    }
  }

  const body = (
    <>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100">{mp.title}</h1>
        <div className="flex items-center gap-3">
          {mp.renewed && (
            <span className="text-xs text-stone-500">
              renewed {mp.renewed.date}
              {mp.renewed.reason ? ` — ${mp.renewed.reason}` : ""}
              {onOpenArchive && (
                <button
                  className="ml-1.5 font-medium text-blue-700 dark:text-blue-400 underline hover:text-blue-900 dark:hover:text-blue-300"
                  onClick={onOpenArchive}
                >
                  archived plan
                </button>
              )}
            </span>
          )}
          {mp.lastUpdated && (
            <span className="text-xs text-stone-500">
              Last updated {mp.lastUpdated}
            </span>
          )}
          {actionsVisible(data) && onRequestReview && (
            <ReviewMenu
              onPick={(agent) => onRequestReview({ agent, scope: "master" })}
            />
          )}
        </div>
      </div>

      <div
        className="mb-4 flex flex-wrap gap-2"
        data-annot-scope="chips"
        data-annot-section="status summary"
      >
        {Object.entries(counts).map(([status, n]) => (
          <span
            key={status}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${CHIP[status as TrackerStatus] ?? CHIP.unknown}`}
          >
            {n} {status}
          </span>
        ))}
      </div>

      <section
        className="mb-4 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4"
        data-annot-scope="context"
        data-annot-section="Project context"
      >
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
          Project context
        </h2>
        <Markdown source={mp.contextMd} className="text-sm" />
      </section>

      {hasRQs && (
        <section className="mb-6 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Research questions
          </h2>
          <ol className="space-y-1 text-sm text-stone-800 dark:text-stone-200">
            {mp.researchQuestions.map((q) => (
              <li
                key={q.num}
                className="flex gap-2"
                data-annot-scope={`rq:${q.num}`}
                data-annot-section={`RQ${q.num}`}
              >
                <span className="shrink-0 rounded bg-stone-900 dark:bg-stone-200 px-1.5 py-0.5 text-xs font-bold text-white dark:text-stone-900">
                  RQ{q.num}
                </span>
                <span>{q.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 dark:border-stone-800 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">Analysis step</th>
              {hasRQs && <th className="px-4 py-2">Serves</th>}
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Plan</th>
              <th className="px-4 py-2">Output</th>
              <th className="px-4 py-2">Report</th>
              <th className="px-4 py-2">Outcome / notes</th>
            </tr>
          </thead>
          <tbody>
            {mp.components.map((r, i) => {
              const slug = slugFromLink(r.planLink);
              const missingFile =
                slug !== null && !knownSlugs.has(slug);
              const serves = parseServes(r.serves);
              const mismatch = servesMismatch(r);
              const g = slug
                ? data.files.executionPlans.find((x) => x.component === slug)
                : null;
              const latestResult = g?.results?.[g.results.length - 1] ?? null;
              const latestPlan = g?.versions[g.versions.length - 1] ?? null;
              const trailerState = latestPlan
                ? latestPlan.trailerState ?? parseExecutionPlan(latestPlan.content).trailerState
                : null;
              const withReport = g
                ? [...(g.results ?? [])].reverse().find((b) => b.publishedReport) ?? null
                : null;
              // A deliberate null result: latest bundle parsed, carries no
              // substantive finding, and no report exists anywhere.
              const noResult =
                !!latestResult &&
                !withReport &&
                !!latestResult.manifest &&
                !hasSubstantiveFindings(latestResult);
              return (
                <tr
                  key={i}
                  id={`tracker-row-${r.num}`}
                  className="border-b border-stone-100 dark:border-stone-800 last:border-0"
                  data-annot-scope={`row:${r.num}`}
                  data-annot-section={`row ${r.num}: ${r.component}`}
                >
                  <td className="px-4 py-2.5 text-stone-400 dark:text-stone-500">{r.num}</td>
                  <td className="px-4 py-2.5 font-medium text-stone-800 dark:text-stone-200">
                    {r.component}
                  </td>
                  {hasRQs && (
                    <td className="px-4 py-2.5">
                      {serves.isInfra ? (
                        <span className="text-xs text-stone-400 dark:text-stone-500">infra</span>
                      ) : serves.tokens.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {serves.tokens.map((t) => (
                            <span
                              key={t}
                              className="rounded bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 text-xs font-semibold text-stone-700 dark:text-stone-300"
                            >
                              {t}
                            </span>
                          ))}
                          {mismatch && (
                            <span
                              className="rounded bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300"
                              title="The execution plan's Serves line disagrees with this row"
                            >
                              mismatch
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="rounded bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                          unlinked
                        </span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${CHIP[r.status]}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {slug && !missingFile ? (
                      <div className="space-y-1">
                        <button
                          className="text-xs font-medium text-blue-700 dark:text-blue-400 underline hover:text-blue-900 dark:hover:text-blue-300"
                          onClick={() => onOpenComponent(slug, r.component)}
                        >
                          open plan
                        </button>
                        {trailerState === "signed" && (
                          <div className="text-[11px] font-medium text-green-700 dark:text-green-400">
                            signed ✓
                          </div>
                        )}
                        {trailerState === "amendment" && (
                          <div className="text-[11px] font-medium text-blue-700 dark:text-blue-400">
                            amended △
                          </div>
                        )}
                        {trailerState === "malformed" && (
                          <div className="text-[11px] font-medium text-red-700 dark:text-red-400">
                            malformed trailer ⚠
                          </div>
                        )}
                      </div>
                    ) : missingFile ? (
                      <span className="rounded bg-red-50 dark:bg-red-950 px-1.5 py-0.5 text-xs text-red-700 dark:text-red-400">
                        linked file missing
                      </span>
                    ) : (
                      <span className="text-xs text-stone-400 dark:text-stone-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {(() => {
                      if (!latestResult)
                        return <span className="text-xs text-stone-400 dark:text-stone-500">—</span>;
                      const mark = bundleStateMark(latestResult).trim();
                      return (
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            className="text-xs font-medium text-blue-700 dark:text-blue-400 underline hover:text-blue-900 dark:hover:text-blue-300"
                            onClick={() => onOpenResults(slug!)}
                          >
                            r{latestResult.resultsVersion} {mark}
                          </button>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2.5">
                    {withReport && onOpenReport ? (
                      <button
                        className="text-xs font-medium text-emerald-700 dark:text-emerald-400 underline hover:text-emerald-900 dark:hover:text-emerald-300"
                        onClick={() =>
                          onOpenReport(slug!, withReport.resultsVersion)
                        }
                      >
                        report
                      </button>
                    ) : noResult ? (
                      <span
                        className="text-xs text-stone-400 dark:text-stone-500"
                        title="This bundle has no substantive findings — no report is generated."
                      >
                        no result
                      </span>
                    ) : (
                      <span className="text-xs text-stone-400 dark:text-stone-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-stone-600 dark:text-stone-400">{r.notes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </section>

      {orphanGroups.length > 0 && (
        <div
          className="mt-3 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-800 dark:text-red-300"
          data-annot-scope="drift"
          data-annot-section="drift notice"
        >
          Drift: execution plan{orphanGroups.length > 1 ? "s" : ""} with no
          tracker row —{" "}
          {orphanGroups.map((g, i) => (
            <button
              key={g.component}
              className="font-medium underline"
              onClick={() => onOpenComponent(g.component, g.component)}
            >
              {g.component}
              {i < orphanGroups.length - 1 ? ", " : ""}
            </button>
          ))}
        </div>
      )}

      {preRenewalGroups.length > 0 && (
        <div
          className="mt-3 rounded-md border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/50 px-3 py-2 text-xs text-stone-600 dark:text-stone-400"
          data-annot-scope="pre-renewal"
          data-annot-section="pre-renewal components"
        >
          Pre-renewal: component{preRenewalGroups.length > 1 ? "s" : ""} from an
          archived master plan —{" "}
          {preRenewalGroups.map((g, i) => (
            <button
              key={g.component}
              className="font-medium underline"
              onClick={() => onOpenComponent(g.component, g.component)}
            >
              {g.component}
              {i < preRenewalGroups.length - 1 ? ", " : ""}
            </button>
          ))}
        </div>
      )}

      {drift.length > 0 && (
        <div
          className="mt-3 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
          data-annot-scope="drift-checks"
          data-annot-section="drift and hygiene"
        >
          <div className="mb-1 font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Drift &amp; hygiene ({drift.length})
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            {drift.map((d, i) => (
              <li key={i}>
                {d.slug ? (
                  <button
                    className="text-left underline hover:text-amber-950"
                    onClick={() => onOpenComponent(d.slug!, d.slug!)}
                  >
                    {d.text}
                  </button>
                ) : (
                  d.text
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mp.foundationsMd && (
        <section
          className="mt-4 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4"
          data-annot-scope="foundations"
          data-annot-section="Foundations"
        >
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Foundations
          </h2>
          <Markdown source={mp.foundationsMd} className="text-sm" />
        </section>
      )}

      {mp.sequencingMd && (
        <section
          className="mt-4 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4"
          data-annot-scope="sequencing"
          data-annot-section="Sequencing notes"
        >
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Sequencing notes
          </h2>
          <Markdown source={mp.sequencingMd} className="text-sm" />
        </section>
      )}
    </>
  );

  return (
    <div>
      {canAnnotate ? (
        <AnnotationLayer
          docKey="tracker"
          annotations={docAnnotations}
          onPaintResult={onPaintResult}
          onAdd={addComment}
        >
          {body}
        </AnnotationLayer>
      ) : (
        body
      )}
      {canAnnotate && (
        <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
          Select any text to attach a comment.
        </p>
      )}
      {canAnnotate && <GeneralCommentBox view="Tracker" onAdd={onAddGeneral} />}
    </div>
  );
}

export function Notice({ text }: { text: string }) {
  return (
    <div className="mb-3 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
      {text}
    </div>
  );
}
