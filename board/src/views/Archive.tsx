import { useEffect, useState } from "react";
import Markdown from "../components/Markdown";
import AnnotationLayer, {
  GeneralCommentBox,
  type AnchoredSelection,
} from "../components/AnnotationLayer";
import { Notice } from "./Tracker";
import { parseMasterPlan, parseServes, slugFromLink } from "../lib/parse";
import type { OutlineEntry } from "../lib/outline";
import type {
  Annotation,
  BoardData,
  DocCommentAnnotation,
  TrackerStatus,
} from "../lib/types";

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

/** Archived master plans (v0.10 renewal record): each renders with the normal
 * master-plan parser — context, RQs, and its components table as it was, rows
 * linking to plans/results where the execution dir still exists. Read-mostly:
 * annotation works like any document; the files themselves are immutable. */
export default function Archive({
  data,
  canAnnotate,
  annotations,
  onAddDocComment,
  onPaintResult,
  onAddGeneral,
  onOpenComponent,
  onOpenResults,
  navRequest,
  onOpenReport,
  onOutline,
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
  onOpenComponent: (slug: string, name: string) => void;
  onOpenResults: (slug: string) => void;
  navRequest?: { token: number; archivePath?: string } | null;
  onOpenReport?: (slug: string, resultsVersion: number) => void;
  onOutline?: (entries: OutlineEntry[]) => void;
}) {
  const archives = data.files.archives ?? [];
  const [idx, setIdx] = useState(Math.max(0, archives.length - 1));
  // Click-sync: resolve a card's archive path to this view's index.
  useEffect(() => {
    if (!navRequest?.archivePath) return;
    const i = archives.findIndex((a) => a.path === navRequest.archivePath);
    if (i >= 0) setIdx(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRequest?.token]);
  const archive = archives[Math.min(idx, archives.length - 1)] ?? null;

  // Archive has no outline of its own — explicitly clear it (robust to future
  // cleanup changes in whichever view precedes it).
  useEffect(() => {
    onOutline?.([]);
  }, [onOutline]);

  if (!archive) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-10 text-center text-sm text-stone-500">
        No archived master plans. Renewing the project's direction with{" "}
        <code>/aict:renew</code> archives the current plan here.
      </div>
    );
  }

  const docKey = `archive:${archive.path}`;
  const mp = parseMasterPlan(archive.content);
  const knownGroups = new Map(
    data.files.executionPlans.map((g) => [g.component, g]),
  );

  const docAnnotations = annotations.filter(
    (a): a is DocCommentAnnotation =>
      a.type === "doc-comment" && a.docKey === docKey,
  );
  const addComment = (partial: AnchoredSelection) =>
    onAddDocComment({ ...partial, view: "archive", docKey });

  const body = (
    <>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100">{mp.title}</h1>
        <span className="rounded bg-stone-200 dark:bg-stone-700 px-2 py-0.5 text-xs font-medium text-stone-700 dark:text-stone-300">
          archived {archive.archivedOn || ""}
        </span>
      </div>
      <Notice text="Archived master plan — the project renewed away from this direction. This record is immutable; its components remain browsable below." />

      {!mp.ok ? (
        <Markdown source={mp.raw} />
      ) : (
        <>
          <section
            className="mb-4 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4"
            data-annot-scope="context"
            data-annot-section="Project context (archived)"
          >
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
              Project context
            </h2>
            <Markdown source={mp.contextMd} className="text-sm" />
          </section>

          {mp.researchQuestions.length > 0 && (
            <section className="mb-4 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Research questions
              </h2>
              <ol className="space-y-1 text-sm text-stone-800 dark:text-stone-200">
                {mp.researchQuestions.map((q) => (
                  <li key={q.num} className="flex gap-2">
                    <span className="shrink-0 rounded bg-stone-500 px-1.5 py-0.5 text-xs font-bold text-white">
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
                  <th className="px-4 py-2">Serves</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Plan</th>
                  <th className="px-4 py-2">Output</th>
                  <th className="px-4 py-2">Outcome / notes</th>
                </tr>
              </thead>
              <tbody>
                {mp.components.map((r, i) => {
                  const slug = slugFromLink(r.planLink);
                  const g = slug ? knownGroups.get(slug) : undefined;
                  const serves = parseServes(r.serves);
                  const latest = g?.results?.[g.results.length - 1];
                  return (
                    <tr
                      key={i}
                      className="border-b border-stone-100 dark:border-stone-800 last:border-0"
                      data-annot-scope={`row:${r.num}`}
                      data-annot-section={`archived row ${r.num}: ${r.component}`}
                    >
                      <td className="px-4 py-2.5 text-stone-400 dark:text-stone-500">{r.num}</td>
                      <td className="px-4 py-2.5 font-medium text-stone-800 dark:text-stone-200">
                        {r.component}
                      </td>
                      <td className="px-4 py-2.5">
                        {serves.isInfra ? (
                          <span className="text-xs text-stone-400 dark:text-stone-500">infra</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {serves.tokens.map((t) => (
                              <span
                                key={t}
                                className="rounded bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 text-xs font-semibold text-stone-700 dark:text-stone-300"
                              >
                                {t}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${CHIP[r.status]}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {slug && g && g.versions.length > 0 ? (
                          <button
                            className="text-xs font-medium text-blue-700 dark:text-blue-400 underline hover:text-blue-900 dark:hover:text-blue-300"
                            onClick={() => onOpenComponent(slug, r.component)}
                          >
                            open plan
                          </button>
                        ) : (
                          <span className="text-xs text-stone-400 dark:text-stone-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {slug && latest ? (
                          <span className="inline-flex items-center gap-2">
                            <button
                              className="text-xs font-medium text-blue-700 dark:text-blue-400 underline hover:text-blue-900 dark:hover:text-blue-300"
                              onClick={() => onOpenResults(slug)}
                            >
                              r{latest.resultsVersion}
                            </button>
                            {(() => {
                              const withReport = [...(g?.results ?? [])]
                                .reverse()
                                .find((b) => b.publishedReport);
                              return (
                                withReport &&
                                onOpenReport && (
                                  <button
                                    className="text-xs font-medium text-emerald-700 dark:text-emerald-400 underline hover:text-emerald-900 dark:hover:text-emerald-300"
                                    onClick={() =>
                                      onOpenReport(slug, withReport.resultsVersion)
                                    }
                                  >
                                    report
                                  </button>
                                )
                              );
                            })()}
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
        </>
      )}
    </>
  );

  return (
    <div>
      {archives.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {archives.map((a, i) => (
            <button
              key={a.path}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                i === Math.min(idx, archives.length - 1)
                  ? "border-stone-900 bg-stone-900 dark:bg-stone-200 text-white dark:text-stone-900"
                  : "border-stone-300 dark:border-stone-600 bg-white text-stone-600 hover:border-stone-500 dark:hover:border-stone-400"
              }`}
              onClick={() => setIdx(i)}
            >
              {a.archivedOn || a.path.split("/").pop()}
            </button>
          ))}
        </div>
      )}
      {canAnnotate ? (
        <AnnotationLayer
          docKey={docKey}
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
      {canAnnotate && <GeneralCommentBox view="Archive" onAdd={onAddGeneral} />}
    </div>
  );
}
