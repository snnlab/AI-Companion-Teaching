import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "../components/Markdown";
import DocxHtml from "../components/DocxHtml";
import A4Pages from "../components/A4Pages";
import type { Layout } from "../lib/pagination";
import PrintManuscript, { type PrintComment } from "../components/PrintManuscript";
import { fmtDate } from "../lib/fmtDate";
import AnnotationLayer, {
  GeneralCommentBox,
  type AnchoredSelection,
} from "../components/AnnotationLayer";
import { Notice } from "./Tracker";
import { outlineFromContainer, type OutlineEntry } from "../lib/outline";
import type { ActiveFileRef } from "../lib/filesTree";
import type { Annotation, BoardData, DocCommentAnnotation } from "../lib/types";

// Always pass an assets map (even empty) so an unresolved figure renders as
// its alt text rather than a broken <img> pointing at a relative path.
const NO_ASSETS: Record<string, string> = {};

export default function Manuscript({
  data,
  canAnnotate,
  annotations,
  onAddDocComment,
  onPaintResult,
  onAddGeneral,
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
  onOutline?: (entries: OutlineEntry[]) => void;
  onActiveFile?: (ref: ActiveFileRef | null) => void;
}) {
  const manuscript = data.files.manuscript ?? null;
  const readable = manuscript && manuscript.format !== "unsupported";
  const bodyRef = useRef<HTMLElement>(null);
  const [printing, setPrinting] = useState(false);
  const [withComments, setWithComments] = useState(true);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const onLayout = useCallback((l: Layout | null) => {
    setLayout(l);
    setPageCount(l ? l.pages.length : 0);
  }, []);

  useEffect(() => {
    onOutline?.(readable ? outlineFromContainer(bodyRef.current, layout?.pageOf) : []);
    return () => onOutline?.([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOutline, readable, manuscript?.content, layout]);

  useEffect(() => {
    if (!readable) return;
    onActiveFile?.({ id: "manuscript", label: "Manuscript" });
    return () => onActiveFile?.(null);
  }, [onActiveFile, readable]);

  if (!manuscript) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-10 text-center text-sm text-stone-500">
        <p className="mb-1 font-medium text-stone-600 dark:text-stone-300">
          No manuscript yet
        </p>
        <p>
          Write your paper draft in <code>plans/manuscript.md</code> (or
          Word, <code>plans/manuscript.docx</code>) — it will show up here,
          and your instructor can leave feedback on it directly.
        </p>
      </div>
    );
  }

  if (manuscript.format === "unsupported") {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-10 text-center text-sm text-stone-500">
        <p className="mb-1 font-medium text-stone-600 dark:text-stone-300">
          Can't preview {manuscript.path}
        </p>
        <p>{manuscript.note}</p>
      </div>
    );
  }

  const docAnnotations = annotations.filter(
    (a): a is DocCommentAnnotation =>
      a.type === "doc-comment" &&
      a.view === "manuscript" &&
      a.docKey === manuscript.path &&
      Boolean(a.quote),
  );
  const addComment = (partial: AnchoredSelection) =>
    onAddDocComment({ ...partial, view: "manuscript", docKey: manuscript.path });
  const printComments: PrintComment[] = [
    ...docAnnotations.map((a) => ({ a, author: a.author })),
    ...annotations
      .filter((a): a is Extract<Annotation, { type: "general" }> => a.type === "general" && a.view === "Manuscript")
      .map((a) => ({ a })),
  ];
  const printSubtitle = [
    manuscript.path + (manuscript.modifiedAt ? ` (saved ${fmtDate(manuscript.modifiedAt)})` : ""),
    data.snapshot ? `submitted ${fmtDate(data.snapshot.submittedAt)}` : `board of ${data.generatedAt.slice(0, 16).replace("T", " ")}`,
    `printed ${fmtDate(new Date().toISOString())}`,
  ].join(" · ");

  const body = (
    <A4Pages contentKey={`${manuscript.path}\u0000${manuscript.content}`} onLayout={onLayout}>
      <section
        ref={bodyRef}
        className="a4-flow"
        data-annot-scope="manuscript"
        data-annot-section="manuscript"
      >
        {manuscript.format === "docx-html" ? (
          <DocxHtml html={manuscript.content} assets={manuscript.assets ?? NO_ASSETS} />
        ) : (
          <Markdown source={manuscript.content} assets={manuscript.assets ?? NO_ASSETS} math />
        )}
      </section>
    </A4Pages>
  );

  return (
    <div className="min-w-0">
      {manuscript.format === "docx-text" && manuscript.note && (
        <Notice text={manuscript.note} />
      )}
      <div className="mb-2 flex max-w-[52rem] flex-wrap items-center justify-end gap-3 text-xs text-stone-600 dark:text-stone-300">
        <span className="mr-auto min-w-0 break-words text-stone-500 dark:text-stone-400" data-testid="manuscript-source">
          <code>{manuscript.path}</code>
          {manuscript.modifiedAt ? ` · saved ${fmtDate(manuscript.modifiedAt)}` : ""}
        </span>
        {pageCount > 0 && (
          <span
            className="rounded-full border border-stone-300 dark:border-stone-600 px-2 py-0.5 tabular-nums"
            data-testid="manuscript-pages"
            title="Pages laid out by the board: A4, 1-inch margins. Page numbers can differ from the student's Word file."
          >
            A4 · {pageCount} {pageCount === 1 ? "page" : "pages"}
          </span>
        )}
        {printComments.length > 0 && (
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={withComments}
              onChange={(e) => setWithComments(e.target.checked)}
            />
            Include comments ({printComments.length})
          </label>
        )}
        <button
          type="button"
          className="rounded-md border border-stone-300 dark:border-stone-600 px-2.5 py-1 font-medium hover:border-stone-500 dark:hover:border-stone-400"
          onClick={() => setPrinting(true)}
          title="Opens your browser's print dialog — choose “Save as PDF” there for a PDF"
        >
          Print / Save as PDF
        </button>
      </div>
      {printing && (
        <PrintManuscript
          manuscript={manuscript}
          title={data.project.name}
          subtitle={printSubtitle}
          comments={printComments}
          includeComments={withComments && printComments.length > 0}
          onDone={() => setPrinting(false)}
        />
      )}
      <AnnotationLayer
        readOnly={!canAnnotate}
        docKey={manuscript.path}
        annotations={docAnnotations}
        onPaintResult={onPaintResult}
        onAdd={addComment}
      >
        {body}
      </AnnotationLayer>
      {canAnnotate && (
        <GeneralCommentBox view="Manuscript" onAdd={onAddGeneral} />
      )}
    </div>
  );
}
