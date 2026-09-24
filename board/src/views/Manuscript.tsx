import { useEffect, useRef } from "react";
import Markdown from "../components/Markdown";
import AnnotationLayer, {
  GeneralCommentBox,
  type AnchoredSelection,
} from "../components/AnnotationLayer";
import { Notice } from "./Tracker";
import { outlineFromContainer, type OutlineEntry } from "../lib/outline";
import type { ActiveFileRef } from "../lib/filesTree";
import type { Annotation, BoardData, DocCommentAnnotation } from "../lib/types";

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

  useEffect(() => {
    onOutline?.(readable ? outlineFromContainer(bodyRef.current) : []);
    return () => onOutline?.([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOutline, readable, manuscript?.content]);

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
          Write your paper draft in <code>plans/manuscript.md</code> — it will
          show up here, and your instructor can leave feedback on it directly.
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

  const body = (
    <section
      ref={bodyRef}
      className="max-w-[52rem] rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-6"
      data-annot-scope="manuscript"
      data-annot-section="manuscript"
    >
      <Markdown source={manuscript.content} />
    </section>
  );

  return (
    <div className="min-w-0">
      {manuscript.format === "docx-text" && manuscript.note && (
        <Notice text={manuscript.note} />
      )}
      {canAnnotate ? (
        <AnnotationLayer
          docKey={manuscript.path}
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
        <GeneralCommentBox view="Manuscript" onAdd={onAddGeneral} />
      )}
    </div>
  );
}
