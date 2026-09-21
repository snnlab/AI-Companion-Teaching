import { useEffect, useMemo, useRef, useState } from "react";
import ArtifactCard from "../components/ArtifactCard";
import ViewerModal from "../components/ViewerModal";
import ProvenanceFlow from "../components/ProvenanceFlow";
import ScriptViewer from "../components/ScriptViewer";
import AnnotationLayer, {
  type AnchoredSelection,
} from "../components/AnnotationLayer";
import ReviewMenu from "../components/ReviewMenu";
import ModelChip from "../components/ModelChip";
import { coerceModelUsage } from "../lib/modelUsage";
import { Notice } from "./Tracker";
import { parseExecutionPlan, preRenewalSlugs } from "../lib/parse";
import type { ViewerRequest } from "../lib/artifactDisplay";
import { actionsVisible } from "../lib/actions";
import { hasSubstantiveFindings } from "../lib/findings";
import { bundleStateBadge, bundleStateMark } from "../lib/bundleState";
import type { OutlineEntry } from "../lib/outline";
import type { ActiveFileRef } from "../lib/filesTree";
import type {
  Annotation,
  BoardData,
  ReportRequest,
  ResultCommentAnnotation,
  ResultsBundle,
  ReviewRequest,
  ScriptCommentAnnotation,
  ValidationBlock,
  IntegrityBlock,
  ReopenRequest,
} from "../lib/types";

const STATUS_CLS: Record<string, string> = {
  robust: "border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-300",
  marginal: "border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-300",
  descriptive: "border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950 text-sky-800 dark:text-sky-300",
  retracted: "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400",
  superseded: "border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-800 text-stone-500",
};

const VALIDATION_CLS: Record<ValidationBlock["status"], string> = {
  conforms: "border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-300",
  "conforms-with-amendments": "border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950 text-sky-800 dark:text-sky-300",
  "deviations-found": "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-200",
  unverifiable: "border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400",
  "not-applicable": "border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/50 text-stone-400 dark:text-stone-500",
  skipped: "border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/50 text-stone-400 dark:text-stone-500",
};

const STEP_MARK: Record<string, { mark: string; cls: string }> = {
  followed: { mark: "✓", cls: "text-green-700 dark:text-green-400" },
  amended: { mark: "~", cls: "text-sky-700 dark:text-sky-400" },
  "deviated-unrecorded": { mark: "✗", cls: "text-amber-700 dark:text-amber-400" },
  "not-executed": { mark: "✗", cls: "text-red-700 dark:text-red-400" },
  unverifiable: { mark: "○", cls: "text-stone-400 dark:text-stone-500" },
};

/** Plan-vs-execution audit (v0.10), sealed in the bundle at capture. */
function ValidationSection({ v }: { v: ValidationBlock }) {
  return (
    <details
      className="mb-4 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-4 py-2"
      data-annot-scope="validation"
      data-annot-section="validation"
      open={v.status === "deviations-found"}
    >
      <summary className="cursor-pointer select-none py-1 text-sm">
        <span
          className={`mr-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${VALIDATION_CLS[v.status] ?? VALIDATION_CLS.unverifiable}`}
        >
          {v.status}
        </span>
        <span className="font-semibold text-stone-800 dark:text-stone-200">
          Validation — plan vs execution
        </span>
        {v.validatedAt && (
          <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">{v.validatedAt}</span>
        )}
        {v.modelUsage && (
          <ModelChip usage={coerceModelUsage(v.modelUsage)} label="validated by" className="ml-2" />
        )}
      </summary>
      {v.reason && <p className="mt-2 text-xs text-stone-500">{v.reason}</p>}
      {(v.steps ?? []).length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {v.steps!.map((s, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <span className={STEP_MARK[s.verdict]?.cls ?? "text-stone-400 dark:text-stone-500"}>
                {STEP_MARK[s.verdict]?.mark ?? "○"}
              </span>
              <span className="font-medium text-stone-700 dark:text-stone-300">{s.planStep}</span>
              <span className="text-stone-400 dark:text-stone-500">{s.verdict}</span>
              {s.evidence && <span className="text-stone-500">— {s.evidence}</span>}
            </li>
          ))}
        </ul>
      )}
      {(v.criteria ?? []).length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-stone-100 dark:border-stone-800 pt-2 text-xs">
          {v.criteria!.map((c, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <span
                className={
                  c.verdict === "met"
                    ? "text-green-700 dark:text-green-400"
                    : c.verdict === "not-met"
                      ? "text-red-700 dark:text-red-400"
                      : "text-stone-400 dark:text-stone-500"
                }
              >
                {c.verdict === "met" ? "✓" : c.verdict === "not-met" ? "✗" : "○"}
              </span>
              <span className="font-medium text-stone-700 dark:text-stone-300">{c.criterion}</span>
              <span className="text-stone-400 dark:text-stone-500">{c.verdict}</span>
              {c.evidence && <span className="text-stone-500">— {c.evidence}</span>}
            </li>
          ))}
        </ul>
      )}
      {v.notes && (
        <p className="mt-2 border-t border-stone-100 dark:border-stone-800 pt-2 text-xs text-stone-600 dark:text-stone-400">
          {v.notes}
        </p>
      )}
    </details>
  );
}

const INTEGRITY_CLS: Record<IntegrityBlock["status"], string> = {
  passed: "border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-300",
  failed: "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-200",
};

/** Mechanical integrity pass (sha256, artifact refs, findings sourced), sealed
 *  at finalize. Always shown on Results — the reviewing surface — so every
 *  bundle carries a validation result; "not recorded" for pre-integrity bundles. */
function IntegritySection({ integrity }: { integrity: IntegrityBlock | null }) {
  if (!integrity) {
    return (
      <div
        className="mb-4 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-4 py-2 text-sm"
        data-annot-scope="integrity"
        data-annot-section="integrity"
      >
        <span className="mr-2 rounded-full border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
          not recorded
        </span>
        <span className="font-semibold text-stone-800 dark:text-stone-200">Integrity</span>
        <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">
          captured before integrity checks
        </span>
      </div>
    );
  }
  return (
    <details
      className="mb-4 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-4 py-2"
      data-annot-scope="integrity"
      data-annot-section="integrity"
      open={integrity.status === "failed"}
    >
      <summary className="cursor-pointer select-none py-1 text-sm">
        <span
          className={`mr-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${INTEGRITY_CLS[integrity.status] ?? INTEGRITY_CLS.failed}`}
        >
          {integrity.status}
        </span>
        <span className="font-semibold text-stone-800 dark:text-stone-200">Integrity</span>
        {integrity.checkedAt && (
          <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">{integrity.checkedAt}</span>
        )}
      </summary>
      <ul className="mt-2 space-y-1 text-xs">
        {integrity.checks.map((c, i) => (
          <li key={i} className="flex flex-wrap gap-x-2">
            <span className={c.verdict === "pass" ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}>
              {c.verdict === "pass" ? "✓" : "✗"}
            </span>
            <span className="font-medium text-stone-700 dark:text-stone-300">{c.name}</span>
            {c.detail && <span className="text-stone-500">— {c.detail}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function SummaryOnlyNotice() {
  return (
    <div className="mb-4 rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-800/50 p-5 text-sm text-stone-600 dark:text-stone-400">
      <div className="font-semibold text-stone-700 dark:text-stone-300">Summary only</div>
      <p className="mt-1">
        No figures or tables in this bundle. The report and metrics were
        captured, but the analysis outputs could not be reproduced (common for
        retrospective captures, where outputs were never saved to files). If a
        producing script exists, re-run it and capture again; otherwise run{" "}
        <code>/aict:results</code> and name the output file paths
        directly.
      </p>
    </div>
  );
}

export default function Results({
  data,
  canAnnotate,
  selectedComponent,
  annotations,
  onAddResultComment,
  onAddScriptComment,
  onPaintResult,
  focusResults,
  onRequestReview,
  onRequestReport,
  onReopen,
  navRequest,
  onOutline,
  onActiveFile,
}: {
  data: BoardData;
  canAnnotate: boolean;
  selectedComponent: string | null;
  annotations: Annotation[];
  onAddResultComment: (a: Omit<ResultCommentAnnotation, "id" | "type">) => void;
  onAddScriptComment: (a: Omit<ScriptCommentAnnotation, "id" | "type">) => void;
  onPaintResult: (
    painted: Set<string>,
    docKey: string,
    scopeAbsent: Set<string>,
  ) => void;
  focusResults: number | null;
  onRequestReview?: (req: ReviewRequest) => void;
  onRequestReport?: (req: ReportRequest) => void;
  onReopen?: (req: ReopenRequest) => void;
  // Click-sync (control surface): one-shot navigation to a bundle/script.
  navRequest?: {
    token: number;
    resultsVersion?: number;
    scriptPath?: string;
  } | null;
  onOutline?: (entries: OutlineEntry[]) => void;
  onActiveFile?: (ref: ActiveFileRef | null) => void;
}) {
  const groups = data.files.executionPlans.filter(
    (g) => (g.results ?? []).length > 0,
  );
  const preRenewal = preRenewalSlugs(data);
  const group =
    groups.find((g) => g.component === selectedComponent) ?? groups[0] ?? null;
  const bundles = useMemo(() => group?.results ?? [], [group]);

  const [idx, setIdx] = useState(() => {
    if (focusResults !== null) {
      const i = bundles.findIndex((b) => b.resultsVersion === focusResults);
      if (i !== -1) return i;
    }
    return Math.max(0, bundles.length - 1);
  });
  // Reset to the latest bundle when the researcher switches component — but NOT
  // on first mount, so an initial focusResults pin (--focus slug:rN, e.g. a
  // results-review reopen) lands on the reviewed bundle instead of the latest.
  const lastComponent = useRef(group?.component);
  useEffect(() => {
    if (lastComponent.current === group?.component) return;
    lastComponent.current = group?.component;
    setIdx(Math.max(0, bundles.length - 1));
  }, [group?.component, bundles.length]);
  const bundle = bundles[Math.min(idx, bundles.length - 1)] ?? null;

  const [openScript, setOpenScript] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [zoom, setZoom] = useState<{ url: string; title: string } | null>(null);
  const [viewer, setViewer] = useState<{
    request: ViewerRequest;
    assets: Record<string, string>;
  } | null>(null);
  useEffect(() => {
    setOpenScript(null);
    setViewer(null);
  }, [bundle?.dir]);
  // Apply a click-sync navigation request. When the request also switches the
  // bundle, its script target is stashed and applied AFTER the reset effect
  // above nulls openScript on the bundle change (same-render effect order) —
  // otherwise the reset would immediately close the requested script.
  const pendingNavScript = useRef<{ script: string | null } | null>(null);
  const navLastComponent = useRef(group?.component);
  useEffect(() => {
    if (!navRequest) return;
    const script = navRequest.scriptPath ?? null;
    const componentChanged = navLastComponent.current !== group?.component;
    navLastComponent.current = group?.component;
    if (navRequest.resultsVersion !== undefined) {
      const i = bundles.findIndex((b) => b.resultsVersion === navRequest.resultsVersion);
      if (i >= 0 && (componentChanged || i !== Math.min(idx, bundles.length - 1))) {
        pendingNavScript.current = { script };
        setIdx(i);
        return;
      }
    }
    setOpenScript(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRequest?.token]);
  useEffect(() => {
    if (!pendingNavScript.current) return;
    setOpenScript(pendingNavScript.current.script);
    pendingNavScript.current = null;
  }, [bundle?.dir]);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  const bundleAnnotations = useMemo(
    () =>
      annotations.filter(
        (a) =>
          (a.type === "result-comment" || a.type === "script-comment") &&
          group !== null &&
          a.component === group.component &&
          a.resultsVersion === (bundle?.resultsVersion ?? -1),
      ),
    [annotations, group, bundle],
  );

  const outlineEntries = useMemo<OutlineEntry[]>(() => {
    const m = bundle?.manifest;
    if (!m) return [];
    // Normalize like the view does (Results.tsx:622) — a manifest.json may omit
    // metrics/artifacts, and `.some`/`.length` on undefined would crash. An
    // existing regression test deletes metrics (Results.integrity.test.tsx:98).
    const metrics = Array.isArray(m.metrics) ? m.metrics : [];
    const artifacts = Array.isArray(m.artifacts) ? m.artifacts : [];
    const findingMode = metrics.some((mt) => (mt.artifactIds?.length ?? 0) > 0 || mt.statement);
    const jump = (id: string) => () =>
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    const es: OutlineEntry[] = [];
    if (m.integrity) es.push({ id: "results-integrity", label: "Integrity", level: 1, onSelect: jump("results-integrity") });
    if (m.validation) es.push({ id: "results-validation", label: "Validation", level: 1, onSelect: jump("results-validation") });
    if (findingMode || metrics.length > 0) es.push({ id: "results-findings", label: "Findings", level: 1, onSelect: jump("results-findings") });
    if (artifacts.length > 0) es.push({ id: "results-artifacts", label: "Artifacts", level: 1, onSelect: jump("results-artifacts") });
    es.push({ id: "results-provenance", label: "Provenance", level: 1, onSelect: jump("results-provenance") });
    return es;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle?.dir]);
  useEffect(() => {
    onOutline?.(outlineEntries);
    return () => onOutline?.([]);
  }, [onOutline, outlineEntries]);
  useEffect(() => {
    if (!bundle || !group) return;
    onActiveFile?.({
      id: `${group.component}:r${bundle.resultsVersion}`,
      label: `r${bundle.resultsVersion} — ${group.component}`,
    });
    return () => onActiveFile?.(null);
  }, [onActiveFile, bundle, group]);

  if (!group || !bundle) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-10 text-center text-sm text-stone-500">
        No results captured yet. Capture a bundle with{" "}
        <code>/aict:results</code>.
      </div>
    );
  }

  const m = bundle.manifest;
  const badge = bundleStateBadge(bundle);

  // Drag-select anywhere in the bundle body; the stamped scope routes the
  // comment to its structured target (metric / artifact / report).
  const addSelectionComment = (partial: AnchoredSelection) => {
    const base = {
      component: group.component,
      resultsVersion: bundle.resultsVersion,
      comment: partial.comment,
      category: partial.category,
    };
    // surfaceScope records WHERE the selection was made (diagram node vs
    // card), so the highlight repaints on that surface — a provenance:<id>
    // node and its artifact:<id> card would otherwise be ambiguous.
    const common = {
      quote: partial.quote,
      occurrenceIndex: partial.occurrenceIndex,
      surfaceScope: partial.scope || undefined,
    };
    const target =
      partial.scope.startsWith("metric:")
        ? {
            kind: "metric" as const,
            metricLabel: partial.scope.slice("metric:".length),
            ...common,
          }
        : partial.scope.startsWith("artifact:")
          ? {
              kind: "artifact" as const,
              artifactId: partial.scope.slice("artifact:".length),
              ...common,
            }
          : partial.scope.startsWith("provenance:")
            ? {
                kind: "artifact" as const,
                artifactId: partial.scope.slice("provenance:".length),
                ...common,
              }
            : {
                kind: "report" as const,
                ...common,
              };
    onAddResultComment({ ...base, target });
  };

  // Only quote-carrying comments paint; scope re-derived from the target.
  const paintable = bundleAnnotations
    .filter(
      (a): a is ResultCommentAnnotation =>
        a.type === "result-comment" && Boolean(a.target.quote),
    )
    .map((a) => ({
      id: a.id,
      quote: a.target.quote!,
      occurrenceIndex: a.target.occurrenceIndex ?? 0,
      // The recorded surface wins (v0.11: a diagram node vs its card); older
      // annotations fall back to the scope derived from the target kind.
      scope:
        a.target.surfaceScope ??
        (a.target.kind === "metric"
          ? `metric:${a.target.metricLabel}`
          : a.target.kind === "artifact"
            ? `artifact:${a.target.artifactId}`
            : "report"),
    }));

  return (
    <div className="min-w-0">
      <div className="min-w-0 flex-1">
        {/* version strip */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {bundles.map((b, i) => {
            return (
              <button
                key={b.dir}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  i === Math.min(idx, bundles.length - 1)
                    ? "border-stone-900 bg-stone-900 dark:bg-stone-200 text-white dark:text-stone-900"
                    : "border-stone-300 dark:border-stone-600 bg-white text-stone-600 hover:border-stone-500 dark:hover:border-stone-400"
                }`}
                onClick={() => setIdx(i)}
                title={bundleStateBadge(b).label}
              >
                r{b.resultsVersion}
                {b.manifest?.planVersion != null
                  ? ` · plan v${b.manifest.planVersion}`
                  : ""}
                {bundleStateMark(b)}
              </button>
            );
          })}
          {actionsVisible(data) && (onRequestReview || onRequestReport) && (
            <div className="ml-auto flex items-center gap-2">
              {/* No report for a null result: a bundle with no substantive
                  finding gets no narrative — /report would refuse anyway. */}
              {onRequestReport && hasSubstantiveFindings(bundle) && (
                <button
                  className="rounded-full border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:border-emerald-500 dark:hover:border-emerald-400"
                  onClick={() =>
                    onRequestReport({
                      component: group.component,
                      resultsVersion: bundle.resultsVersion,
                    })
                  }
                  title="Assemble a shareable report for this bundle (md + pdf/docx) — sends the request and ends this board session"
                >
                  Generate report
                </button>
              )}
              {onRequestReview && (
                <ReviewMenu
                  onPick={(agent) =>
                    onRequestReview({
                      agent,
                      scope: "results",
                      component: group.component,
                      resultsVersion: bundle.resultsVersion,
                    })
                  }
                />
              )}
            </div>
          )}
        </div>

        {/* verdict banner */}
        <div
          className={`mb-4 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 ${badge.cls}`}
        >
          <span className="text-sm font-semibold">
            {group.component} r{bundle.resultsVersion} — {badge.label}
          </span>
          {bundle.verdict && (
            <span className="text-xs">
              legacy verdict: {bundle.verdict.status} · {bundle.verdict.reviewer} · {bundle.verdict.date}
              {bundle.verdict.comment ? ` — “${bundle.verdict.comment}”` : ""}
            </span>
          )}
          {m?.modelUsage && (
            <ModelChip usage={coerceModelUsage(m.modelUsage)} label="captured by" />
          )}
          {m?.provenance === "retrofit" && (
            <span
              className="rounded bg-stone-200 dark:bg-stone-700 px-1.5 py-0.5 text-[11px] font-medium text-stone-700 dark:text-stone-300"
              title={
                m.planVersion != null
                  ? "Documented by a retrospective plan (written after the work), not prospectively governed."
                  : "Produced outside any plan."
              }
            >
              {m.planVersion != null
                ? `retrofit — documented by a retrospective plan (v${m.planVersion})`
                : "retrofit — produced outside a plan"}
            </span>
          )}
          {m?.late && (
            <span
              className="rounded bg-stone-200 dark:bg-stone-700 px-1.5 py-0.5 text-[11px] font-medium text-stone-700 dark:text-stone-300"
              title="Backfilled: captured after the run; script snapshots show the code as of capture time"
            >
              captured late
            </span>
          )}
          {m?.trigger === "redo-after-review" && (
            <span className="rounded bg-stone-200 dark:bg-stone-700 px-1.5 py-0.5 text-[11px] font-medium text-stone-700 dark:text-stone-300">
              redo after review
            </span>
          )}
          {preRenewal.has(group.component) && (
            <span
              className="rounded bg-stone-200 dark:bg-stone-700 px-1.5 py-0.5 text-[11px] font-medium text-stone-700 dark:text-stone-300"
              title="This component belongs to an archived master plan (pre-renewal). Browsable and reviewable; not tracked by the current plan."
            >
              pre-renewal
            </span>
          )}
          {actionsVisible(data) && onReopen && (
            <span
              data-reload-guard={reopenReason.trim() ? "" : undefined}
              className="ml-auto flex items-center gap-2"
            >
              <input
                className="w-56 rounded-md border border-stone-300 dark:border-stone-600 px-2 py-1 text-xs"
                placeholder="Reopen — why? (required)"
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
              />
              <button
                className="rounded-md border border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-40"
                disabled={!reopenReason.trim()}
                title="Files a change request against this finalized bundle; any recorded verdict or validation is never modified."
                onClick={() =>
                  onReopen({
                    component: group.component,
                    resultsVersion: bundle.resultsVersion,
                    reason: reopenReason.trim(),
                  })
                }
              >
                Reopen — request changes
              </button>
            </span>
          )}
        </div>

        {!m && (
          <Notice text="This bundle's manifest.json did not parse — showing what can be shown." />
        )}

        {(() => {
          // `metrics` is typed required, but a manifest.json may omit it —
          // normalize once so a metrics-less bundle can't crash the tiles/gallery.
          const metrics = m && Array.isArray(m.metrics) ? m.metrics : [];
          const findingMode = metrics.some(
            (mt) => (mt.artifactIds && mt.artifactIds.length > 0) || mt.statement,
          );
          const onZoom = (url: string, title: string) => setZoom({ url, title });
          const onView = (v: ViewerRequest) =>
            setViewer({ request: v, assets: bundle.assets });
          const planFile =
            m && m.planVersion != null
              ? group.versions.find((v) => v.version === m.planVersion)
              : null;
          const planGoal = planFile
            ? parseExecutionPlan(planFile.content).goal
            : null;
          const bundleBody = (
            <>
              {/* Validation, promoted to the top: Results is the reviewing
                  surface — "did it check out?". Integrity (mechanical, every
                  bundle) then plan-vs-execution (planned bundles). No prose:
                  the capture note now lives only in the Report narrative. */}
              {m && (
                <div id="results-integrity">
                  <IntegritySection integrity={m.integrity ?? null} />
                </div>
              )}
              {m?.validation && (
                <div id="results-validation">
                  <ValidationSection v={m.validation} />
                </div>
              )}

              {m && findingMode ? (
                <>
                  <div id="results-findings">
                    {/* key claims — compact tiles; figures live in the Evidence
                        gallery below and, in context, on the Reports tab */}
                    {metrics.map((metric) => (
                      <section
                        key={metric.label}
                        data-annot-scope={`metric:${metric.label}`}
                        data-annot-section={`metric ${metric.label}`}
                        className="mb-4 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5"
                      >
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          {metric.status && (
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                STATUS_CLS[metric.status] ?? STATUS_CLS.descriptive
                              }`}
                            >
                              {metric.status}
                            </span>
                          )}
                          <span className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
                            {metric.label}
                          </span>
                        </div>
                        {metric.statement && (
                          <p className="mb-1 font-serif text-lg leading-snug text-stone-900 dark:text-stone-100">
                            {metric.statement}
                          </p>
                        )}
                        <div className="text-base font-bold text-stone-900 dark:text-stone-100">
                          {metric.value}
                        </div>
                        {metric.note && (
                          <div className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">
                            {metric.note}
                          </div>
                        )}
                      </section>
                    ))}
                  </div>

                  <div id="results-artifacts">
                    {m.artifacts.length === 0 && <SummaryOnlyNotice />}
                    {m.artifacts.length > 0 && (
                      <section className="mb-4">
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                          Evidence
                        </h3>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          {m.artifacts.map((art) => (
                            <ArtifactCard
                              key={art.id}
                              art={art}
                              bundle={bundle}
                              openScript={openScript}
                              setOpenScript={setOpenScript}
                              onZoom={onZoom}
                              onView={onView}
                            />
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div id="results-findings">
                    {/* backward-compat: metric tiles + full gallery */}
                    {metrics.length > 0 && (
                      <div className="mb-4 flex flex-wrap gap-3">
                        {metrics.map((metric) => (
                          <div
                            key={metric.label}
                            data-annot-scope={`metric:${metric.label}`}
                            data-annot-section={`metric ${metric.label}`}
                            className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-4 py-2 text-left"
                          >
                            <div className="text-[11px] uppercase tracking-wide text-stone-500">
                              {metric.label}
                            </div>
                            <div className="text-lg font-bold text-stone-900 dark:text-stone-100">
                              {metric.value}
                            </div>
                            {metric.note && (
                              <div className="text-[11px] text-stone-400 dark:text-stone-500">
                                {metric.note}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div id="results-artifacts">
                    {m && m.artifacts.length === 0 ? (
                      <SummaryOnlyNotice />
                    ) : m ? (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {m.artifacts.map((art) => (
                          <ArtifactCard
                            key={art.id}
                            art={art}
                            bundle={bundle}
                            openScript={openScript}
                            setOpenScript={setOpenScript}
                            onZoom={onZoom}
                            onView={onView}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                </>
              )}

              {/* provenance flow diagram (v0.11) — now closes the review read */}
              {m && (
                <div id="results-provenance">
                  {m.curatedBy === "agent" && (
                    <div className="mb-2 text-xs font-medium text-stone-500 dark:text-stone-400">
                      curated by agent (autopilot)
                    </div>
                  )}
                  <ProvenanceFlow
                    bundle={bundle}
                    planGoal={planGoal}
                    onOpenScript={setOpenScript}
                    onZoom={onZoom}
                  />
                </div>
              )}
            </>
          );
          return canAnnotate ? (
            <AnnotationLayer
              docKey={bundle.dir}
              annotations={paintable}
              onPaintResult={onPaintResult}
              onAdd={addSelectionComment}
            >
              {bundleBody}
            </AnnotationLayer>
          ) : (
            bundleBody
          );
        })()}

        {canAnnotate && (
          <p className="mb-2 text-xs text-stone-400 dark:text-stone-500">
            Select any text — a metric, an artifact title or caption — to attach
            a comment.
          </p>
        )}

        {/* script drawer */}
        {openScript &&
          (() => {
            const sf = bundle.scripts.find((s) => s.path === openScript);
            if (!sf) return null;
            return (
              <section className="mt-4">
                <ScriptViewer
                  file={sf}
                  canAnnotate={canAnnotate}
                  saved={bundleAnnotations.filter(
                    (a): a is ScriptCommentAnnotation =>
                      a.type === "script-comment" && a.script === sf.path,
                  )}
                  onAddLineComment={(lineStart, lineEnd, excerpt, comment) =>
                    onAddScriptComment({
                      component: group.component,
                      resultsVersion: bundle.resultsVersion,
                      script: sf.path,
                      lineStart,
                      lineEnd,
                      excerpt,
                      comment,
                    })
                  }
                />
              </section>
            );
          })()}

        {zoom && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
            role="dialog"
            aria-label={`Enlarged: ${zoom.title}`}
            onClick={() => setZoom(null)}
          >
            <img
              src={zoom.url}
              alt={zoom.title}
              className="max-h-full max-w-full rounded object-contain"
            />
          </div>
        )}
        {viewer && (
          <ViewerModal
            request={viewer.request}
            assets={viewer.assets}
            onClose={() => setViewer(null)}
          />
        )}
      </div>
    </div>
  );
}
