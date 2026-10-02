import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { anchorFromSelection, paintHighlights } from "../lib/anchor";
import { SentIdsContext } from "../lib/sentIds";

interface Pending {
  x: number;
  y: number;
  anchor: ReturnType<typeof anchorFromSelection>;
}

/** The minimal shape the paint pass needs; plan comments, doc comments, and
 * quote-carrying result comments are all structurally assignable. */
export interface PaintableAnnotation {
  id: string;
  quote: string;
  occurrenceIndex: number;
  scope?: string;
}

/** What a saved selection-comment hands back to the view: the anchor fields
 * plus the comment text. Views spread in their own identity fields. */
export interface AnchoredSelection {
  quote: string;
  prefix: string;
  suffix: string;
  sectionHeading: string;
  scope: string;
  occurrenceIndex: number;
  anchored: boolean;
  comment: string;
  // Instructor-flagged integrity concern (Phase 1); absent = ordinary feedback.
  category?: "integrity";
}

export default function AnnotationLayer({
  children,
  annotations,
  onAdd,
  onPaintResult,
  docKey,
  readOnly = false,
}: {
  children: ReactNode;
  // Paint highlights only — no selection composer. Views mount the layer in
  // every mode so existing comments always show in place (a snapshot board,
  // a static export); only boards that may comment pass readOnly={false}.
  readOnly?: boolean;
  annotations: PaintableAnnotation[];
  onAdd: (a: AnchoredSelection) => void;
  onPaintResult: (
    paintedIds: Set<string>,
    docKey: string,
    scopeAbsent: Set<string>,
  ) => void;
  docKey: string; // changes when the displayed document changes
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sentIds = useContext(SentIdsContext);
  const [pending, setPending] = useState<Pending | null>(null);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const [integrityFlag, setIntegrityFlag] = useState(false);

  // Re-paint highlights when annotations or the displayed doc change.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const t = window.setTimeout(() => {
      const outcome = paintHighlights(
        el,
        annotations.map((a) => ({
          id: a.id,
          quote: a.quote,
          occurrenceIndex: a.occurrenceIndex,
          scope: a.scope,
          kind: sentIds.has(a.id) ? ("sent" as const) : ("draft" as const),
        })),
      );
      onPaintResult(outcome.painted, docKey, outcome.scopeAbsent);
    }, 0);
    return () => window.clearTimeout(t);
  }, [annotations, docKey, onPaintResult, sentIds]);

  const captureSelection = useCallback(() => {
    if (composing || readOnly) return;
    const el = containerRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const anchor = anchorFromSelection(el);
    if (!anchor) {
      setPending(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect?.() ?? {
      left: 0,
      bottom: 0,
      width: 0,
    };
    const host = el.getBoundingClientRect();
    setPending({
      x: rect.left - host.left + rect.width / 2,
      y: rect.bottom - host.top + 6,
      anchor,
    });
  }, [composing, readOnly]);

  const handleMouseUp = useCallback(() => {
    // Only the composer knows when it is done; a mouseup while it is open is
    // the user clicking its own buttons, not clearing their selection.
    if (composing) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setPending(null);
      return;
    }
    captureSelection();
  }, [captureSelection, composing]);

  useEffect(() => {
    document.addEventListener("selectionchange", captureSelection);
    return () => document.removeEventListener("selectionchange", captureSelection);
  }, [captureSelection]);

  const save = () => {
    if (!pending?.anchor || !text.trim()) return;
    onAdd({
      quote: pending.anchor.quote,
      prefix: pending.anchor.prefix,
      suffix: pending.anchor.suffix,
      sectionHeading: pending.anchor.sectionHeading,
      scope: pending.anchor.scope,
      occurrenceIndex: pending.anchor.occurrenceIndex,
      anchored: true,
      comment: text.trim(),
      category: integrityFlag ? "integrity" : undefined,
    });
    setText("");
    setIntegrityFlag(false);
    setComposing(false);
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="relative">
      {/* The listener sits on the content, not the wrapper: a mouseup on the
       * Comment button or the composer is a click on our own UI, and clearing
       * the pending anchor there unmounts the target before its click lands. */}
      <div ref={containerRef} onMouseUp={handleMouseUp}>
        {children}
      </div>

      {pending && !composing && (
        <button
          className="absolute z-20 -translate-x-1/2 rounded-full bg-stone-900 dark:bg-stone-200 px-3 py-1 text-xs font-medium text-white dark:text-stone-900 shadow-lg hover:bg-stone-700 dark:hover:bg-stone-400"
          style={{ left: pending.x, top: pending.y }}
          onClick={() => setComposing(true)}
          aria-label="Comment on selected text"
        >
          Comment
        </button>
      )}

      {pending && composing && (
        <div
          data-reload-guard=""
          className="absolute z-20 w-72 -translate-x-1/2 rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-2 shadow-xl"
          style={{ left: Math.max(150, pending.x), top: pending.y }}
        >
          <div className="mb-1 line-clamp-2 rounded bg-amber-50 dark:bg-amber-950 px-2 py-1 text-xs text-stone-600 dark:text-stone-400">
            “{pending.anchor?.quote}”
          </div>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                save();
              }
              if (e.key === "Escape") {
                setComposing(false);
                setPending(null);
                setIntegrityFlag(false);
              }
            }}
            placeholder="Your comment… (↵ to save, ⇧↵ for a new line)"
            className="h-20 w-full resize-none rounded border border-stone-200 dark:border-stone-800 p-2 text-sm outline-none focus:border-stone-400 dark:focus:border-stone-500"
          />
          <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
            <input
              type="checkbox"
              checked={integrityFlag}
              onChange={(e) => setIntegrityFlag(e.target.checked)}
            />
            Flag as an integrity concern
          </label>
          <div className="mt-1 flex justify-end gap-2">
            <button
              className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
              onClick={() => {
                setComposing(false);
                setPending(null);
                setIntegrityFlag(false);
              }}
            >
              Cancel
            </button>
            <button
              className="rounded bg-stone-900 dark:bg-stone-200 px-3 py-1 text-xs font-medium text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400 disabled:opacity-40"
              disabled={!text.trim()}
              onClick={save}
            >
              Save comment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function GeneralCommentBox({
  view,
  onAdd,
}: {
  view: string;
  onAdd: (view: string, comment: string, category?: "integrity") => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [integrityFlag, setIntegrityFlag] = useState(false);
  const commit = () => {
    if (!text.trim()) return;
    onAdd(view, text.trim(), integrityFlag ? "integrity" : undefined);
    setText("");
    setIntegrityFlag(false);
    setOpen(false);
  };
  if (!open) {
    return (
      <button
        className="mt-6 rounded-md border border-dashed border-stone-300 dark:border-stone-600 px-3 py-1.5 text-xs text-stone-500 hover:border-stone-400 dark:hover:border-stone-500 hover:text-stone-700"
        onClick={() => setOpen(true)}
      >
        + General comment on this view
      </button>
    );
  }
  return (
    <div
      data-reload-guard=""
      className="mt-6 rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-2 shadow-sm"
    >
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setOpen(false);
            setIntegrityFlag(false);
          }
        }}
        placeholder={`General comment on the ${view} view… (↵ to add)`}
        className="h-16 w-full resize-none rounded border border-stone-200 dark:border-stone-800 p-2 text-sm outline-none focus:border-stone-400 dark:focus:border-stone-500"
      />
      <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
        <input
          type="checkbox"
          checked={integrityFlag}
          onChange={(e) => setIntegrityFlag(e.target.checked)}
        />
        Flag as an integrity concern
      </label>
      <div className="mt-1 flex justify-end gap-2">
        <button
          className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          onClick={() => {
            setOpen(false);
            setIntegrityFlag(false);
          }}
        >
          Cancel
        </button>
        <button
          className="rounded bg-stone-900 dark:bg-stone-200 px-3 py-1 text-xs font-medium text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400 disabled:opacity-40"
          disabled={!text.trim()}
          onClick={commit}
        >
          Add to feedback
        </button>
      </div>
    </div>
  );
}
