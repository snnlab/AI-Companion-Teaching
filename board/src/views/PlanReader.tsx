import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PlanBody from "../components/PlanBody";
import ModelChip from "../components/ModelChip";
import ScorePanel from "../components/ScorePanel";
import { parsePlanModelMarker } from "../lib/modelUsage";
import DiffView from "../components/DiffView";
import AnnotationLayer from "../components/AnnotationLayer";
import ReviewMenu from "../components/ReviewMenu";
import { Notice } from "./Tracker";
import {
  parseExecutionPlan,
  parseMasterPlan,
  parseScorecard,
  parseServes,
} from "../lib/parse";
import { actionsVisible } from "../lib/actions";
import { bundleStateMark } from "../lib/bundleState";
import type {
  Annotation,
  BoardData,
  DraftSnapshotFile,
  ExecutionPlanGroup,
  ParsedExecutionPlan,
  PlanCommentAnnotation,
  ReviewRequest,
} from "../lib/types";
import type { OutlineEntry } from "../lib/outline";
import type { ActiveFileRef } from "../lib/filesTree";
import { prefersReducedMotion, useScrollSpy } from "../lib/scrollSpy";

type DocKind = "signed" | "workingDraft" | "draftSnapshot";

interface DocRef {
  group: ExecutionPlanGroup;
  version: number;
  iteration?: number; // draftSnapshot only
  docKind: DocKind;
  isDraft: boolean; // convenience: docKind !== "signed"
  path: string;
  content: string;
}

const docLabel = (d: DocRef): string =>
  d.docKind === "draftSnapshot"
    ? `v${d.version}·d${d.iteration}`
    : d.docKind === "workingDraft"
      ? `proposed v${d.version}`
      : `v${d.version}`;


/** "[label](target)" → "label"; plain strings pass through. */
export function linkLabel(v: string): string {
  return /^\[([^\]]+)\]\([^)]*\)$/.exec(v.trim())?.[1] ?? v;
}

function metadataRows(parsed: ParsedExecutionPlan): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (parsed.componentSlug) rows.push(["Component", parsed.componentSlug]);
  if (parsed.version != null) rows.push(["Version", `v${parsed.version}`]);
  if (parsed.date) rows.push(["Date", parsed.date]);
  if (parsed.provenance) rows.push(["Provenance", parsed.provenance]);
  if (parsed.supersedes) rows.push(["Supersedes", parsed.supersedes]);
  if (parsed.masterPlan) rows.push(["Master plan", linkLabel(parsed.masterPlan)]);
  return rows;
}

function MetadataCard({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-800 dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-200">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <span className="font-medium" style={{ color: "var(--aict-prose-muted)" }}>{k}</span>
          <span>{v}</span>
        </Fragment>
      ))}
    </div>
  );
}


export default function PlanReader({
  data,
  canAnnotate,
  selectedComponent,
  annotations,
  onAddPlanComment,
  onPaintResult,
  onOpenResults,
  onRequestReview,
  navRequest,
  onOpenReport,
  onOutline,
  onActiveOutline,
  onActiveFile,
}: {
  data: BoardData;
  canAnnotate: boolean;
  selectedComponent: string | null;
  annotations: Annotation[];
  onAddPlanComment: (
    a: Omit<PlanCommentAnnotation, "id" | "type">,
  ) => void;
  onPaintResult: (
    paintedIds: Set<string>,
    docKey: string,
    scopeAbsent: Set<string>,
  ) => void;
  onOpenResults: (slug: string) => void;
  onRequestReview?: (req: ReviewRequest) => void;
  // Click-sync (control surface): one-shot navigation request from a feedback
  // card. Internal selection stays authoritative; each new token overrides.
  navRequest?: { token: number; planPath?: string } | null;
  onOpenReport?: (slug: string, resultsVersion: number) => void;
  onOutline?: (entries: OutlineEntry[]) => void;
  onActiveOutline?: (id: string | null) => void;
  onActiveFile?: (ref: ActiveFileRef | null) => void;
}) {
  const groups = data.files.executionPlans;
  const group =
    groups.find((g) => g.component === selectedComponent) ?? groups[0] ?? null;

  // The full version history in chronological order: for each version number,
  // its committed draft iterations (vN-draft-K) in order, then the signed vN (or
  // the still-unsigned working draft). Reads idea → signed left to right.
  const docs: DocRef[] = useMemo(() => {
    if (!group) return [];
    const snapsByVersion = new Map<number, DraftSnapshotFile[]>();
    for (const s of group.draftSnapshots ?? []) {
      const list = snapsByVersion.get(s.version) ?? [];
      list.push(s);
      snapsByVersion.set(s.version, list);
    }
    const signedByVersion = new Map(group.versions.map((v) => [v.version, v]));
    const draftVersion = group.draft?.proposedVersion ?? null;
    const versionNums = [
      ...new Set<number>([
        ...group.versions.map((v) => v.version),
        ...(group.draftSnapshots ?? []).map((s) => s.version),
        ...(draftVersion !== null ? [draftVersion] : []),
      ]),
    ].sort((a, b) => a - b);

    const out: DocRef[] = [];
    let draftPushed = false;
    const pushDraft = () => {
      if (!group.draft) return;
      out.push({
        group,
        version: group.draft.proposedVersion,
        docKind: "workingDraft",
        isDraft: true,
        path: group.draft.path,
        content: group.draft.content,
      });
      draftPushed = true;
    };
    for (const n of versionNums) {
      for (const s of (snapsByVersion.get(n) ?? [])
        .slice()
        .sort((a, b) => a.iteration - b.iteration)) {
        out.push({
          group,
          version: n,
          iteration: s.iteration,
          docKind: "draftSnapshot",
          isDraft: true,
          path: s.path,
          content: s.content,
        });
      }
      const signed = signedByVersion.get(n);
      if (signed) {
        out.push({
          group,
          version: n,
          docKind: "signed",
          isDraft: false,
          path: signed.path,
          content: signed.content,
        });
      }
      // The working draft shows at its proposedVersion when that version has no
      // signed vN yet. If a signed vN already exists there, the draft is a stale
      // leftover — still shown (appended at the end) so the stale banner can warn.
      if (draftVersion === n && !signed) pushDraft();
    }
    if (!draftPushed) pushDraft();
    return out;
  }, [group]);

  const [docIdx, setDocIdx] = useState(docs.length - 1);
  useEffect(() => setDocIdx(docs.length - 1), [group?.component, docs.length]);
  // Apply a click-sync navigation request: resolve the target path to this
  // view's own index. User clicks afterwards still work (state stays local).
  useEffect(() => {
    if (!navRequest?.planPath) return;
    const i = docs.findIndex((d) => d.path === navRequest.planPath);
    if (i >= 0) setDocIdx(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRequest?.token]);
  const curIdx = Math.min(docIdx, docs.length - 1);
  const doc = docs[curIdx] ?? null;
  useEffect(() => {
    if (!doc) return;
    const label =
      doc.docKind === "workingDraft"
        ? `proposed v${doc.version} (draft) — ${doc.group.component}`
        : doc.docKind === "draftSnapshot"
          ? `v${doc.version}·d${doc.iteration} — ${doc.group.component}`
          : `v${doc.version} — ${doc.group.component}`;
    onActiveFile?.({ id: doc.path, label });
    return () => onActiveFile?.(null);
  }, [onActiveFile, doc]);

  // Reader detail level (project default; the reader can still toggle any block).
  const level = data.detailLevel ?? "standard";

  // Diff base is the immediately preceding step in the version history (previous
  // snapshot, signed version, or working draft) — reads the evolution in order.
  const prevDoc = curIdx > 0 ? docs[curIdx - 1] : null;

  const [diffOn, setDiffOn] = useState(false);
  useEffect(() => {
    setDiffOn(Boolean(doc?.isDraft && prevDoc));
  }, [doc?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // Strip the leading aict-model provenance marker before parsing/rendering/diff
  // (a malformed one would otherwise swallow the plan body in Markdown).
  const planMarker = useMemo(
    () => (doc ? parsePlanModelMarker(doc.content) : null),
    [doc],
  );
  const docBody = planMarker ? planMarker.body : "";
  const prevBody = useMemo(
    () => (prevDoc ? parsePlanModelMarker(prevDoc.content).body : ""),
    [prevDoc],
  );
  const parsed = useMemo(
    () => (planMarker ? parseExecutionPlan(planMarker.body) : null),
    [planMarker],
  );
  const cardRows = parsed?.ok ? metadataRows(parsed) : [];

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeHeading = useScrollSpy(
    scrollRef,
    "[data-outline-id]",
    [doc?.path, level, diffOn],
  );
  const scrollToSection = useCallback((heading: string) => {
    // Every section heading renders even when its body is collapsed, so scrolling
    // to the h2 works at any detail level.
    const doScroll = () => {
      const host = scrollRef.current;
      if (!host) return;
      for (const h of host.querySelectorAll("h2")) {
        if ((h.textContent ?? "").trim() === heading) {
          h.scrollIntoView({
            behavior: prefersReducedMotion() ? "auto" : "smooth",
            block: "start",
          });
          return;
        }
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(doScroll));
  }, []);

  const outlineEntries = useMemo<OutlineEntry[]>(
    () =>
      parsed?.ok && !(diffOn && prevDoc)
        ? parsed.sections.map((s) => ({
            id: s.heading,
            label: s.heading,
            level: 1,
            onSelect: () => scrollToSection(s.heading),
          }))
        : [],
    [parsed, diffOn, prevDoc, scrollToSection],
  );
  useEffect(() => {
    onOutline?.(outlineEntries);
    return () => onOutline?.([]);
  }, [onOutline, outlineEntries]);
  useEffect(() => {
    onActiveOutline?.(
      activeHeading?.getAttribute("data-outline-id") ?? null,
    );
    return () => onActiveOutline?.(null);
  }, [onActiveOutline, activeHeading]);

  const docAnnotations = useMemo(
    () =>
      annotations.filter(
        (a): a is PlanCommentAnnotation =>
          a.type === "plan-comment" && doc !== null && a.planPath === doc.path && a.quote.trim() !== "",
      ),
    [annotations, doc],
  );

  // The five-channel score for THIS document, matched by the scorecard's
  // authoritative planPath. v0.20: the working draft is scorable too (the
  // review room scores before sign-off; review.md's idempotence rule migrates
  // the card's planPath to the signed file). Snapshots never carry a score.
  // A duplicate match is ambiguous — show nothing rather than a wrong score.
  const scorecard = useMemo(() => {
    if (!doc || (doc.docKind !== "signed" && doc.docKind !== "workingDraft")) return null;
    const matches = data.files.reviews
      .map((r) => parseScorecard(r.content))
      .filter((sc) => sc && sc.planPath === doc.path);
    return matches.length === 1 ? matches[0] : null;
  }, [doc, data.files.reviews]);

  const [globalOpen, setGlobalOpen] = useState(false);
  const [globalText, setGlobalText] = useState("");
  useEffect(() => {
    setGlobalOpen(false);
    setGlobalText("");
  }, [doc?.path]);

  if (!group || !doc) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-10 text-center text-sm text-stone-500">
        No analysis plans yet. Scope the first component with{" "}
        <code>/aict:plan</code>.
      </div>
    );
  }

  const stale =
    doc.docKind === "workingDraft" &&
    group.versions.some((v) => v.version >= (group.draft?.proposedVersion ?? 0));

  // Snapshots (committed draft iterations) are read-only: viewed and diffed,
  // never annotated. Feedback routing must not touch an immutable snapshot.
  const annotatable = canAnnotate && doc.docKind !== "draftSnapshot";

  const saveGlobal = () => {
    if (!globalText.trim()) return;
    onAddPlanComment({
      quote: "", prefix: "", suffix: "", sectionHeading: "", scope: "",
      occurrenceIndex: 0, anchored: false,
      planPath: doc.path, component: group.component, version: doc.version, isDraft: doc.isDraft,
      comment: globalText.trim(),
    });
    setGlobalOpen(false);
    setGlobalText("");
  };

  return (
    <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          {docs.map((d, i) =>
            d.docKind === "draftSnapshot" ? null : (
              <button
                key={d.path}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  i === curIdx
                    ? "border-stone-900 bg-stone-900 dark:bg-stone-200 text-white dark:text-stone-900"
                    : "border-stone-300 dark:border-stone-600 bg-white text-stone-600 hover:border-stone-500 dark:hover:border-stone-400"
                } ${d.docKind === "workingDraft" ? "border-dashed" : ""}`}
                onClick={() => setDocIdx(i)}
              >
                {d.docKind === "workingDraft"
                  ? `proposed v${d.version} (draft)`
                  : `v${d.version}`}
              </button>
            ),
          )}
          <div className="ml-auto flex items-center gap-2">
            {annotatable && !diffOn && (
              <button
                className="rounded-full border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-1 text-xs font-medium text-stone-600 hover:border-stone-500 dark:hover:border-stone-400"
                onClick={() => setGlobalOpen((o) => !o)}
              >
                Global comment
              </button>
            )}
            {scorecard && <ScorePanel scorecard={scorecard} />}
            {actionsVisible(data) && onRequestReview && doc.docKind !== "draftSnapshot" && (
              <ReviewMenu
                onPick={(agent) =>
                  onRequestReview({
                    agent,
                    scope: "plan",
                    component: group.component,
                    version: doc.version,
                    planPath: doc.path,
                    isDraft: doc.isDraft,
                  })
                }
              />
            )}
            {prevDoc && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-stone-600 dark:text-stone-400">
                <input
                  type="checkbox"
                  checked={diffOn}
                  onChange={(e) => setDiffOn(e.target.checked)}
                />
                Diff vs {docLabel(prevDoc)}
              </label>
            )}
          </div>
        </div>

        {annotatable && globalOpen && !diffOn && (
          <div
            data-reload-guard=""
            className="mb-3 rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-2 shadow-sm"
          >
            <textarea
              autoFocus
              value={globalText}
              onChange={(e) => setGlobalText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveGlobal();
                if (e.key === "Escape") { setGlobalOpen(false); setGlobalText(""); }
              }}
              placeholder="A comment on this whole plan… (⌘↵ to save)"
              className="h-20 w-full resize-none rounded border border-stone-200 dark:border-stone-800 p-2 text-sm outline-none focus:border-stone-400 dark:focus:border-stone-500"
            />
            <div className="mt-1 flex justify-end gap-2">
              <button
                className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                onClick={() => { setGlobalOpen(false); setGlobalText(""); }}
              >
                Cancel
              </button>
              <button
                className="rounded bg-stone-900 dark:bg-stone-200 px-3 py-1 text-xs font-medium text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400 disabled:opacity-40"
                disabled={!globalText.trim()}
                onClick={saveGlobal}
              >
                Save comment
              </button>
            </div>
          </div>
        )}

        {docs.some((d) => d.docKind === "draftSnapshot") && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs uppercase tracking-wide text-stone-400 dark:text-stone-500">
              iterations
            </span>
            {docs.map((d, i) =>
              d.docKind !== "draftSnapshot" ? null : (
                <button
                  key={d.path}
                  title="Committed draft iteration — read-only"
                  className={`rounded border px-2 py-0.5 text-xs ${
                    i === curIdx
                      ? "border-stone-900 bg-stone-100 font-semibold text-stone-900 dark:text-stone-100"
                      : "border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 text-stone-500 hover:border-stone-500 dark:hover:border-stone-400"
                  }`}
                  onClick={() => setDocIdx(i)}
                >
                  {docLabel(d)}
                </button>
              ),
            )}
          </div>
        )}

        {(group.results ?? []).some(
          (b) => b.manifest?.planVersion === doc.version && !doc.isDraft,
        ) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
            Results under this version:
            {(group.results ?? [])
              .filter((b) => b.manifest?.planVersion === doc.version)
              .map((b) => (
                <Fragment key={b.dir}>
                  <button
                    className="rounded-full border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-2 py-0.5 font-medium text-blue-700 dark:text-blue-400 hover:border-stone-500 dark:hover:border-stone-400"
                    onClick={() => onOpenResults(group.component)}
                  >
                    r{b.resultsVersion}
                    {bundleStateMark(b)}
                  </button>
                  {b.publishedReport && onOpenReport && (
                    <button
                      className="rounded-full border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-stone-900 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400 hover:border-emerald-500"
                      onClick={() => onOpenReport(group.component, b.resultsVersion)}
                    >
                      report
                    </button>
                  )}
                </Fragment>
              ))}
          </div>
        )}

        {doc.docKind === "workingDraft" && (
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
              Unsigned draft
            </span>
            {stale && (
              <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-red-800 dark:bg-red-950 dark:text-red-300">
                Stale — a signed version already supersedes this draft
              </span>
            )}
          </div>
        )}

        {doc.docKind === "draftSnapshot" && (
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-400">
              Draft iteration {docLabel(doc)} · read-only
            </span>
          </div>
        )}

        {parsed?.ok &&
          parsed.serves &&
          (() => {
            const mp = parseMasterPlan(data.files.masterPlan.content);
            const tokens = parseServes(parsed.serves).tokens;
            const rqs = mp.ok
              ? mp.researchQuestions.filter((q) => tokens.includes(`RQ${q.num}`))
              : [];
            return (
              <div className="mb-2">
                <span className="rounded bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-xs font-semibold text-stone-700 dark:text-stone-300">
                  Serves: {parsed.serves}
                </span>
                {rqs.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {rqs.map((q) => (
                      <li key={q.num} className="text-[11px] leading-snug text-stone-500">
                        <span className="font-semibold text-stone-600 dark:text-stone-400">
                          RQ{q.num}
                        </span>{" "}
                        — {q.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })()}

        {parsed && !parsed.ok && (
          <Notice text="This plan did not match the expected execution-plan format — showing it raw." />
        )}

        {diffOn && prevDoc ? (
          <DiffView
            before={prevBody}
            after={docBody}
            supersedesReason={parsed?.supersedes ?? null}
          />
        ) : (
          <div
            ref={scrollRef}
            className="max-w-[52rem] rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-6"
          >
            {planMarker?.modelUsage && (
              <div className="mb-3 flex justify-end">
                <ModelChip usage={planMarker.modelUsage} />
              </div>
            )}
            {planMarker?.malformed && (
              <div className="mb-3 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                This plan's model-provenance marker is unreadable — the plan body is shown; regenerate or fix the marker to restore the model chip.
              </div>
            )}
            {cardRows.length > 0 && <MetadataCard rows={cardRows} />}
            {annotatable ? (
              <AnnotationLayer
                docKey={doc.path}
                annotations={docAnnotations}
                onPaintResult={onPaintResult}
                onAdd={(partial) =>
                  onAddPlanComment({
                    ...partial,
                    planPath: doc.path,
                    component: group.component,
                    version: doc.version,
                    isDraft: doc.isDraft,
                  })
                }
              >
                <PlanBody content={docBody} level={level} stripMetadata={cardRows.length > 0} />
              </AnnotationLayer>
            ) : (
              <PlanBody content={docBody} level={level} stripMetadata={cardRows.length > 0} />
            )}
          </div>
        )}
        {/* Trailer state lives outside the diff/full-view branch so the sign-off
            hint survives when the diff toggle is on — the state the board lands
            in after a review reopens it on the working draft. */}
        {parsed?.ok && (
          <div className="mt-4 border-t border-stone-100 dark:border-stone-800 pt-3 text-xs">
            {parsed.trailerState === "signed" ? (
              <span className="rounded bg-green-50 dark:bg-green-950 px-2 py-1 font-medium text-green-800 dark:text-green-300">
                signed ✓
              </span>
            ) : parsed.trailerState === "amendment" ? (
              <span className="rounded bg-blue-50 dark:bg-blue-950 px-2 py-1 font-medium text-blue-800 dark:text-blue-300">
                amended △
              </span>
            ) : parsed.trailerState === "malformed" ? (
              <span className="rounded bg-red-50 dark:bg-red-950 px-2 py-1 font-medium text-red-800 dark:text-red-300">
                malformed trailer ⚠
              </span>
            ) : (
              <span className="rounded bg-amber-50 dark:bg-amber-950 px-2 py-1 font-medium text-amber-800 dark:text-amber-300">
                pending — signs at /execute or /sign
              </span>
            )}
          </div>
        )}
        {annotatable && (
          <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
            Select any text in the plan to attach a comment.
          </p>
        )}
        {canAnnotate && doc.docKind === "draftSnapshot" && (
          <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
            Draft iterations are read-only history — open the signed version or
            working draft to comment.
          </p>
        )}
    </div>
  );
}
