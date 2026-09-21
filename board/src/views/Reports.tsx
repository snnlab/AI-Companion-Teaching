import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "../components/Markdown";
import AnnotationLayer, {
  type AnchoredSelection,
} from "../components/AnnotationLayer";
import { Notice } from "./Tracker";
import { preRenewalSlugs } from "../lib/parse";
import { actionsVisible } from "../lib/actions";
import { hasSubstantiveFindings } from "../lib/findings";
import { bundleState, bundleStateBadge } from "../lib/bundleState";
import { parseReport } from "../lib/reportMarker";
import ModelChip from "../components/ModelChip";
import { outlineFromContainer, type OutlineEntry } from "../lib/outline";
import { useScrollSpy } from "../lib/scrollSpy";
import type { ActiveFileRef } from "../lib/filesTree";
import type {
  Annotation,
  BoardData,
  DocCommentAnnotation,
  ReportRequest,
  ResultsBundle,
} from "../lib/types";

function validationState(b: ResultsBundle): string {
  return bundleState(b).validation ?? "none";
}

function GenerateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="rounded-full border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:border-emerald-500 dark:hover:border-emerald-400"
      onClick={onClick}
      title="Assemble the shareable report for this bundle (md + pdf/docx) — sends the request and ends this board session"
    >
      Generate report
    </button>
  );
}

export default function Reports({
  data,
  canAnnotate,
  selectedComponent,
  annotations,
  onAddDocComment,
  onPaintResult,
  onRequestReport,
  focusResults,
  navRequest,
  onOutline,
  onActiveOutline,
  onActiveFile,
}: {
  data: BoardData;
  canAnnotate: boolean;
  selectedComponent: string | null;
  annotations: Annotation[];
  onAddDocComment: (a: Omit<DocCommentAnnotation, "id" | "type">) => void;
  onPaintResult: (
    painted: Set<string>,
    docKey: string,
    scopeAbsent: Set<string>,
  ) => void;
  onRequestReport?: (req: ReportRequest) => void;
  focusResults: number | null;
  navRequest?: { token: number; resultsVersion?: number } | null;
  onOutline?: (entries: OutlineEntry[]) => void;
  onActiveOutline?: (id: string | null) => void;
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
  const lastComponent = useRef(group?.component);
  useEffect(() => {
    if (lastComponent.current === group?.component) return;
    lastComponent.current = group?.component;
    setIdx(Math.max(0, bundles.length - 1));
  }, [group?.component, bundles.length]);
  useEffect(() => {
    if (!navRequest || navRequest.resultsVersion === undefined) return;
    const i = bundles.findIndex(
      (b) => b.resultsVersion === navRequest.resultsVersion,
    );
    if (i >= 0) setIdx(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRequest?.token]);
  const bundle = bundles[Math.min(idx, bundles.length - 1)] ?? null;

  const reportBodyRef = useRef<HTMLElement>(null);
  const reportContent = bundle?.publishedReport?.content ?? "";
  const activeReportHeading = useScrollSpy(
    reportBodyRef,
    "h1, h2, h3",
    [reportContent],
  );
  useEffect(() => {
    // Read the rendered headings (Markdown adds no ids). Rebuild only when the
    // report content changes — never every render, so no publish loop.
    onOutline?.(outlineFromContainer(reportBodyRef.current));
    return () => onOutline?.([]);
  }, [onOutline, reportContent]);
  useEffect(() => {
    const headings = reportBodyRef.current
      ? Array.from(reportBodyRef.current.querySelectorAll("h1, h2, h3"))
      : [];
    const index = activeReportHeading
      ? headings.indexOf(activeReportHeading)
      : -1;
    onActiveOutline?.(index >= 0 ? `h-${index}` : null);
    return () => onActiveOutline?.(null);
  }, [onActiveOutline, activeReportHeading, reportContent]);
  useEffect(() => {
    if (!bundle || !group) return;
    onActiveFile?.({
      id: `${group.component}:report:r${bundle.resultsVersion}`,
      label: `r${bundle.resultsVersion} report — ${group.component}`,
    });
    return () => onActiveFile?.(null);
  }, [onActiveFile, bundle, group]);

  if (!group || !bundle) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-10 text-center text-sm text-stone-500">
        No reports yet — generate one from a results bundle: capture with{" "}
        <code>/aict:results</code>, then use its report offer or the
        Generate report button.
      </div>
    );
  }

  const rep = bundle.publishedReport;
  const parsed = rep ? parseReport(rep.content) : null;
  const marker = parsed?.marker ?? null;
  const fmts = bundle.reportFormats ?? { pdf: false, docx: false };
  const anyFormat = fmts.pdf || fmts.docx;
  // Null result: manifest parsed but carries no substantive finding — nothing
  // to narrate, so no report is generated (see /report gate).
  const noSubstance = !!bundle.manifest && !hasSubstantiveFindings(bundle);
  const latest = bundles[bundles.length - 1];
  const actions = actionsVisible(data) && onRequestReport;
  const generate = () =>
    onRequestReport?.({
      component: group.component,
      resultsVersion: bundle.resultsVersion,
    });
  const generateLatest = () =>
    onRequestReport?.({
      component: group.component,
      resultsVersion: latest.resultsVersion,
    });

  const paintable = annotations
    .filter(
      (a): a is DocCommentAnnotation =>
        a.type === "doc-comment" &&
        a.view === "reports" &&
        a.docKey === (rep?.path ?? "") &&
        Boolean(a.quote),
    )
    .map((a) => ({
      id: a.id,
      quote: a.quote,
      occurrenceIndex: a.occurrenceIndex,
      scope: a.scope,
    }));

  const addSelectionComment = (partial: AnchoredSelection) => {
    if (!rep) return;
    onAddDocComment({ ...partial, view: "reports", docKey: rep.path });
  };

  const reportBody = rep && parsed && (
    <section
      ref={reportBodyRef}
      className="max-w-[52rem] rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-6"
      data-annot-scope="published-report"
      data-annot-section="published report"
    >
      <Markdown source={parsed.body} assets={bundle.assets} />
    </section>
  );

  return (
    <div className="min-w-0">
      {/* bundle picker — rN · plan vN */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {bundles.map((b, i) => (
          <button
            key={b.dir}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              i === Math.min(idx, bundles.length - 1)
                ? "border-stone-900 bg-stone-900 dark:bg-stone-200 text-white dark:text-stone-900"
                : "border-stone-300 dark:border-stone-600 bg-white text-stone-600 hover:border-stone-500 dark:hover:border-stone-400"
            }`}
            onClick={() => setIdx(i)}
          >
            r{b.resultsVersion}
            {b.manifest
              ? b.manifest.planVersion != null
                ? ` · plan v${b.manifest.planVersion}`
                : " · no plan"
              : ""}
            {b.publishedReport ? "" : " ∅"}
          </button>
        ))}
        {actions && rep && bundle.manifest && (
          <div className="ml-auto">
            <GenerateButton onClick={generate} />
          </div>
        )}
      </div>

      {/* header: component, validation state, chips */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-stone-800 dark:text-stone-200">
          {group.component} r{bundle.resultsVersion} — report
        </span>
        <span className="rounded-full border border-stone-200 dark:border-stone-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-stone-500">
          {bundleStateBadge(bundle).label}
        </span>
        {marker?.modelUsage && <ModelChip usage={marker.modelUsage} label="generated by" />}
        {!bundle.manifest && (
          <span className="rounded-full border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-2 py-0.5 text-[10px] text-amber-800 dark:text-amber-300">
            manifest unreadable — plan version unknown
          </span>
        )}
        {preRenewal.has(group.component) && (
          <span className="rounded bg-stone-200 dark:bg-stone-700 px-1.5 py-0.5 text-[10px] text-stone-600 dark:text-stone-400">
            pre-renewal
          </span>
        )}
      </div>

      {/* stale / identity flags */}
      {latest && !latest.publishedReport && latest.resultsVersion !== bundle.resultsVersion && hasSubstantiveFindings(latest) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <span>
            r{latest.resultsVersion} has no report yet — generate one to keep the record current.
          </span>
          {actions && latest.manifest && <GenerateButton onClick={generateLatest} />}
        </div>
      )}
      {rep && marker && (marker.component !== group.component || marker.bundle !== bundle.resultsVersion) && (
        <Notice text={`Wrong file? This report's marker names ${marker.component} r${marker.bundle}, but it sits in ${group.component} r${bundle.resultsVersion}'s slot.`} />
      )}
      {rep && marker && (
        marker.schemaVersion === 2
          ? marker.validation !== validationState(bundle)
          : marker.verdict !== (bundle.verdict?.status ?? "pending")
      ) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <span>
            This report was generated before the current {marker.schemaVersion === 2 ? "validation" : "verdict"} (it says
            “{marker.schemaVersion === 2 ? marker.validation : marker.verdict}”, the bundle is “{marker.schemaVersion === 2 ? validationState(bundle) : (bundle.verdict?.status ?? "pending")}”) —
            regenerate to refresh.
          </span>
          {actions && bundle.manifest && <GenerateButton onClick={generate} />}
        </div>
      )}
      {rep && parsed && !marker && (
        <Notice
          text={
            parsed.malformed
              ? "This report's marker is unreadable (marker unreadable — regenerate to refresh); showing the report body."
              : "This report was generated before verdict tracking — regenerate to refresh its header."
          }
        />
      )}

      {/* body / empty states */}
      {rep ? (
        canAnnotate ? (
          <AnnotationLayer
            docKey={rep.path}
            annotations={paintable}
            onPaintResult={onPaintResult}
            onAdd={addSelectionComment}
          >
            {reportBody}
          </AnnotationLayer>
        ) : (
          reportBody
        )
      ) : noSubstance ? (
        <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-10 text-center text-sm text-stone-500">
          <p className="mb-1 font-medium text-stone-600 dark:text-stone-300">
            No report — no substantive findings
          </p>
          <p>
            This bundle has no substantive findings to report — descriptive
            counts and unmarked metrics don't qualify. The evidence and
            validation are on the Output &amp; Validation tab; there is nothing to narrate
            here.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-10 text-center text-sm text-stone-500">
          <p className="mb-3">
            No report generated for r{bundle.resultsVersion}
            {anyFormat
              ? " — converted files (PDF/DOCX) exist but the markdown is missing; regenerate to restore it."
              : "."}
          </p>
          {actions && bundle.manifest && <GenerateButton onClick={generate} />}
        </div>
      )}

      {/* downloads */}
      {rep && anyFormat && (
        <div className="mt-3 flex items-center gap-2 text-xs text-stone-500">
          {data.mode === "live" ? (
            <>
              {fmts.pdf && (
                <a
                  className="rounded-md border border-stone-300 dark:border-stone-600 px-3 py-1.5 font-medium text-stone-700 dark:text-stone-300 hover:border-stone-500 dark:hover:border-stone-400"
                  href={`/report/${group.component}/r${bundle.resultsVersion}.pdf`}
                  download
                >
                  Download PDF
                </a>
              )}
              {fmts.docx && (
                <a
                  className="rounded-md border border-stone-300 dark:border-stone-600 px-3 py-1.5 font-medium text-stone-700 dark:text-stone-300 hover:border-stone-500 dark:hover:border-stone-400"
                  href={`/report/${group.component}/r${bundle.resultsVersion}.docx`}
                  download
                >
                  Download DOCX
                </a>
              )}
            </>
          ) : (
            <span>
              PDF/DOCX available in <code>plans/reports/</code> in the repo.
            </span>
          )}
        </div>
      )}

      {canAnnotate && rep && (
        <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">
          Select any report text to attach a comment.
        </p>
      )}
    </div>
  );
}
