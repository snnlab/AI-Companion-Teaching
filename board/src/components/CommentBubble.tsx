// Word-style comment balloon: clicking a highlight opens the comment(s)
// anchored there, right next to the text. Rendered in a body portal at
// document coordinates, so the paint pass re-creating <mark>s under it (it
// repaints on every view render) never unmounts or moves the balloon.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Annotation } from "../lib/types";
import { fmtDate } from "../lib/fmtDate";

export interface BubbleItem {
  id: string;
  a: Annotation;
  /** true = stored on the server (hosted); false = a local pending comment. */
  sent: boolean;
  author?: string;
  at?: string;
  editedAt?: string;
  /** The viewer may change this comment (Edit / Delete shown). */
  editable: boolean;
}

export interface BubblePosition {
  /** Document coordinates (page scroll included) of the clicked highlight. */
  left: number;
  top: number;
  bottom: number;
}

const WIDTH = 320;

function quoteOf(a: Annotation): string {
  if (a.type === "plan-comment" || a.type === "doc-comment") return a.quote;
  if (a.type === "result-comment") return a.target.quote ?? "";
  if (a.type === "script-comment") return a.excerpt;
  return "";
}

export default function CommentBubble({
  items,
  pos,
  hosted,
  reviewerReady,
  savingIds,
  onEdit,
  onRemove,
  onSaveDraft,
  onClose,
}: {
  items: BubbleItem[];
  pos: BubblePosition;
  hosted: boolean;
  reviewerReady: boolean;
  savingIds: Set<string>;
  /** Resolve false when the change did not go through (shown inline). */
  onEdit: (item: BubbleItem, text: string) => Promise<boolean>;
  onRemove: (item: BubbleItem) => Promise<boolean>;
  onSaveDraft: (a: Annotation) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; msg: string } | null>(null);

  // Close on Escape, or on a press outside the balloon that is not on another
  // highlight (a highlight press re-targets the balloon via App instead).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || ref.current?.contains(t)) return;
      if (t.closest?.("[data-annotation]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (items.length === 0) return null;

  const docWidth = document.documentElement.clientWidth;
  const width = Math.min(WIDTH, docWidth - 16);
  const left = Math.max(8, Math.min(pos.left, window.scrollX + docWidth - width - 8));

  const saveEdit = async (item: BubbleItem) => {
    const text = draft.trim();
    if (!text || busyId) return;
    setBusyId(item.id);
    setError(null);
    const ok = await onEdit(item, text);
    setBusyId(null);
    if (ok) setEditingId(null);
    else setError({ id: item.id, msg: "Couldn’t save the change — check your connection and try again." });
  };
  const remove = async (item: BubbleItem) => {
    if (busyId) return;
    setBusyId(item.id);
    setError(null);
    const ok = await onRemove(item);
    setBusyId(null);
    setConfirmDeleteId(null);
    if (!ok) setError({ id: item.id, msg: "Couldn’t delete — check your connection and try again." });
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={items.length === 1 ? "Comment" : `${items.length} comments`}
      data-reload-guard=""
      data-comment-bubble=""
      className="absolute z-40 max-h-[60vh] overflow-y-auto rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 shadow-xl"
      style={{ left, top: pos.bottom + 6, width }}
    >
      {items.map((item, i) => {
        const { id, a, sent, author, at, editedAt, editable } = item;
        const quote = quoteOf(a);
        const editing = editingId === id;
        const busy = busyId === id;
        return (
          <div
            key={id}
            className={`p-3 text-xs ${i > 0 ? "border-t border-stone-200 dark:border-stone-800" : ""}`}
          >
            <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
              {author && (
                <span className="font-semibold text-stone-800 dark:text-stone-200">{author}</span>
              )}
              {at && <span>{fmtDate(at)}</span>}
              {editedAt && <span className="italic">Edited · {fmtDate(editedAt)}</span>}
              {hosted && !sent && (
                <span className="rounded bg-amber-100 dark:bg-amber-900/50 px-1 py-0.5 font-medium text-amber-800 dark:text-amber-300">
                  Not saved yet
                </span>
              )}
              {a.category === "integrity" && (
                <span className="rounded bg-rose-100 dark:bg-rose-900/50 px-1 py-0.5 font-semibold text-rose-700 dark:text-rose-300">
                  ⚠ integrity concern
                </span>
              )}
              {i === 0 && (
                <button
                  className="ml-auto rounded px-1.5 text-sm leading-none text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800"
                  onClick={onClose}
                  aria-label="Close"
                  title="Close"
                >
                  ×
                </button>
              )}
            </div>
            {quote && (
              <div className="mb-1.5 line-clamp-2 border-l-2 border-amber-300 dark:border-amber-700 pl-2 text-[11px] italic text-stone-500 dark:text-stone-400">
                {quote}
              </div>
            )}
            {editing ? (
              <div>
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void saveEdit(item);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="h-20 w-full resize-y rounded border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-950 p-1.5 text-xs outline-none focus:border-stone-400"
                />
                <div className="mt-1 flex justify-end gap-2">
                  <button
                    className="rounded px-2 py-0.5 text-[11px] text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded bg-stone-900 dark:bg-stone-200 px-2 py-0.5 text-[11px] font-medium text-white dark:text-stone-900 disabled:opacity-40"
                    disabled={!draft.trim() || busy}
                    onClick={() => void saveEdit(item)}
                  >
                    {busy ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-stone-800 dark:text-stone-200">
                {a.comment}
              </div>
            )}
            {error?.id === id && (
              <p role="alert" className="mt-1.5 text-[11px] text-red-700 dark:text-red-400">
                {error.msg}
              </p>
            )}
            {editable && !editing && (
              confirmDeleteId === id ? (
                <div className="mt-2 flex items-center justify-end gap-2 text-[11px]">
                  <span className="mr-auto text-stone-600 dark:text-stone-300">
                    {sent ? "Delete this comment? The student will no longer see it." : "Delete this comment?"}
                  </span>
                  <button
                    className="rounded px-2 py-0.5 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded bg-red-600 px-2 py-0.5 font-medium text-white hover:bg-red-700 disabled:opacity-40"
                    disabled={busy}
                    onClick={() => void remove(item)}
                  >
                    {busy ? "Deleting…" : "Delete"}
                  </button>
                </div>
              ) : (
                <div className="mt-2 flex items-center justify-end gap-3 text-[11px]">
                  {hosted && !sent && (
                    <button
                      className="mr-auto rounded-md bg-stone-900 dark:bg-stone-200 px-2 py-0.5 font-semibold text-white dark:text-stone-900 disabled:opacity-40"
                      disabled={!reviewerReady || savingIds.has(id)}
                      onClick={() => onSaveDraft(a)}
                    >
                      {savingIds.has(id) ? "Saving…" : "Save"}
                    </button>
                  )}
                  <button
                    className="text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
                    onClick={() => {
                      setEditingId(id);
                      setDraft(a.comment);
                      setConfirmDeleteId(null);
                      setError(null);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="text-stone-500 hover:text-red-600"
                    onClick={() => setConfirmDeleteId(id)}
                  >
                    Delete
                  </button>
                </div>
              )
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
