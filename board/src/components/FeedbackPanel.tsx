// The feedback surface (control surface work, spec §2): a real docked column
// on wide viewports — content reflows, nothing is covered — and the classic
// overlay on narrow ones. Extracted verbatim from App's drawer block; App owns
// all state, this renders it.
import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type {
  Annotation,
  StoredComment,
} from "../lib/types";
import { VIEW_LABEL } from "../lib/feedback";
import { fmtDate } from "../lib/fmtDate";

export type SubmitState =
  | "idle"
  | "sending"
  | "sent"
  | "failed"
  | "downloaded";

// One annotation's card in the panel list. Shared by local pending items
// (deletable, optionally with a hosted Save action) and sent server comments
// (editable/deletable only on the classroom roster, which has the routes).
export function AnnotationCard({
  a,
  sentBy,
  editedAt,
  stale,
  onDelete,
  saveAction,
  onOpen,
  editing,
  draft,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
}: {
  a: Annotation;
  sentBy?: string;
  editedAt?: string;
  stale?: boolean;
  onDelete?: () => void;
  saveAction?: ReactNode;
  onOpen?: () => void;
  editing?: boolean;
  draft?: string;
  onEditStart?: () => void;
  onEditChange?: (t: string) => void;
  onEditSave?: () => void;
  onEditCancel?: () => void;
}) {
  return (
    <div
      className={`rounded-md border border-stone-200 dark:border-stone-800 p-2 text-xs${
        onOpen ? " cursor-pointer hover:border-stone-400 dark:hover:border-stone-500" : ""
      }`}
      data-card-id={a.id}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.key === "Enter") onOpen();
            }
          : undefined
      }
    >
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-stone-500">
        {a.type === "plan-comment" ? (
          <>
            <span className="font-medium text-stone-700 dark:text-stone-300">
              {a.component} v{a.version}
              {a.isDraft ? " (draft)" : ""}
            </span>
            {a.sectionHeading && <span>· {a.sectionHeading}</span>}
            {a.author && (
              <span className="rounded bg-violet-100 dark:bg-violet-900/50 px-1 py-0.5 font-medium text-violet-700 dark:text-violet-300">
                via {a.author}
              </span>
            )}
            {!a.anchored && (
              <span className="rounded bg-stone-100 dark:bg-stone-800 px-1 py-0.5">
                unanchored
              </span>
            )}
          </>
        ) : a.type === "result-comment" ? (
          <>
            <span className="font-medium text-stone-700 dark:text-stone-300">
              {a.component} r{a.resultsVersion} ·{" "}
              {a.target.kind === "artifact"
                ? a.target.artifactId
                : a.target.kind === "metric"
                  ? a.target.metricLabel
                  : "report"}
            </span>
            {a.author && (
              <span className="rounded bg-violet-100 dark:bg-violet-900/50 px-1 py-0.5 font-medium text-violet-700 dark:text-violet-300">
                via {a.author}
              </span>
            )}
            {a.anchored === false && (
              <span className="rounded bg-stone-100 dark:bg-stone-800 px-1 py-0.5">
                unanchored
              </span>
            )}
          </>
        ) : a.type === "script-comment" ? (
          <span className="font-medium text-stone-700 dark:text-stone-300">
            {a.script.split("/").pop()} L{a.lineStart}
            {a.lineEnd !== a.lineStart ? `–${a.lineEnd}` : ""}
          </span>
        ) : a.type === "doc-comment" ? (
          <>
            <span className="font-medium text-stone-700 dark:text-stone-300">
              {VIEW_LABEL[a.view]}
            </span>
            {/* The manuscript's section is the literal "manuscript" — no news. */}
            {a.sectionHeading && a.view !== "manuscript" && <span>· {a.sectionHeading}</span>}
            {a.author && (
              <span className="rounded bg-violet-100 dark:bg-violet-900/50 px-1 py-0.5 font-medium text-violet-700 dark:text-violet-300">
                via {a.author}
              </span>
            )}
            {!a.anchored && (
              <span className="rounded bg-stone-100 dark:bg-stone-800 px-1 py-0.5">
                unanchored
              </span>
            )}
          </>
        ) : (
          <span className="font-medium text-stone-700 dark:text-stone-300">
            {a.view} — general
          </span>
        )}
        {a.category === "integrity" && (
          <span
            className="rounded bg-rose-100 dark:bg-rose-900/50 px-1 py-0.5 font-semibold text-rose-700 dark:text-rose-300"
            title="Flagged by the instructor as an integrity concern"
          >
            ⚠ integrity concern
          </span>
        )}
        {sentBy && (
          <span className="rounded bg-stone-100 dark:bg-stone-800 px-1 py-0.5 font-medium text-stone-600 dark:text-stone-300">
            {sentBy}
          </span>
        )}
        {editedAt && (
          <span className="italic" title={`Edited ${fmtDate(editedAt)}`}>
            edited
          </span>
        )}
        {stale && (
          <span className="rounded bg-amber-100 dark:bg-amber-900/50 px-1 py-0.5 font-medium text-amber-700 dark:text-amber-300">
            outdated
          </span>
        )}
        {(onEditStart || onDelete) && (
          <span className="ml-auto flex items-center gap-2">
            {onEditStart && !editing && (
              <button
                className="text-stone-400 dark:text-stone-500 hover:text-stone-700"
                onClick={(e) => { e.stopPropagation(); onEditStart(); }}
                title="Edit"
              >
                Edit
              </button>
            )}
            {onDelete && (
              <button
                className="text-stone-400 dark:text-stone-500 hover:text-red-600"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                title="Delete"
              >
                ✕
              </button>
            )}
          </span>
        )}
      </div>
      {(a.type === "plan-comment" || a.type === "doc-comment") && a.quote && (
        <div className="mb-1 line-clamp-2 rounded bg-amber-50 dark:bg-amber-950 px-1.5 py-1 text-[11px] italic text-stone-500">
          “{a.quote}”
        </div>
      )}
      {a.type === "result-comment" && a.target.quote && (
        <div className="mb-1 line-clamp-2 rounded bg-amber-50 dark:bg-amber-950 px-1.5 py-1 text-[11px] italic text-stone-500">
          “{a.target.quote}”
        </div>
      )}
      {a.type === "script-comment" && (
        <pre className="mb-1 max-h-16 overflow-hidden rounded bg-stone-50 dark:bg-stone-800/50 px-1.5 py-1 text-[10px] text-stone-500">
          {a.excerpt}
        </pre>
      )}
      {editing ? (
        <div
          data-reload-guard=""
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <textarea
            autoFocus
            value={draft ?? ""}
            onChange={(e) => onEditChange?.(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onEditSave?.();
              if (e.key === "Escape") onEditCancel?.();
            }}
            className="h-16 w-full resize-none rounded border border-stone-200 dark:border-stone-800 p-1.5 text-xs outline-none focus:border-stone-400 dark:focus:border-stone-500"
          />
          <div className="mt-1 flex justify-end gap-2">
            <button
              className="rounded px-2 py-0.5 text-[11px] text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
              onClick={(e) => { e.stopPropagation(); onEditCancel?.(); }}
            >
              Cancel
            </button>
            <button
              className="rounded bg-stone-900 dark:bg-stone-200 px-2 py-0.5 text-[11px] font-medium text-white dark:text-stone-900 disabled:opacity-40"
              disabled={!(draft ?? "").trim()}
              onClick={(e) => { e.stopPropagation(); onEditSave?.(); }}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="text-stone-700 dark:text-stone-300">{a.comment}</div>
      )}
      {saveAction}
    </div>
  );
}

export interface FeedbackPanelProps {
  variant: "docked" | "overlay";
  style?: CSSProperties;
  annotations: Annotation[];
  serverLive: StoredComment[];
  serverStale: StoredComment[];
  hosted: boolean;
  canPost: boolean;
  submitState: SubmitState;
  reviewer: string;
  savingIds: Set<string>;
  onReviewerChange: (v: string) => void;
  onRemove: (id: string) => void;
  onSaveHosted: (a: Annotation) => void;
  onEdit: (id: string, text: string) => void;
  /** Classroom roster only: the sent comments can be changed. */
  canEditSent?: boolean;
  /** Snapshot board: just the instructor's comments, no drafting/sending. */
  readOnly?: boolean;
  onEditSent?: (id: string, text: string) => Promise<boolean>;
  onDeleteSent?: (id: string) => Promise<boolean>;
  onCardClick?: (a: Annotation) => void;
  onClose: () => void;
  onSubmit: () => void;
  onDownload: () => void;
  onCopyFallback: () => void;
}

export default function FeedbackPanel(p: FeedbackPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Sent-comment edits go to the server: a delete needs a second click, and a
  // failure is reported on the card instead of losing the instructor's text.
  const [confirmSentDelete, setConfirmSentDelete] = useState<string | null>(null);
  const [sentBusy, setSentBusy] = useState<string | null>(null);
  const [sentError, setSentError] = useState<{ id: string; msg: string } | null>(null);
  // If the edited annotation disappears (a hosted per-card Save completes, or a
  // request clears drafts), clear editingId so submit/download/copy don't stay
  // frozen on a comment that no longer exists.
  useEffect(() => {
    if (
      editingId !== null &&
      !p.annotations.some((a) => a.id === editingId) &&
      !p.serverLive.some((c) => c.id === editingId)
    ) {
      setEditingId(null);
      setDraft("");
    }
  }, [p.annotations, p.serverLive, editingId]);
  const shell =
    p.variant === "docked"
      ? "sticky flex w-[380px] shrink-0 flex-col border-l border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900"
      : "fixed right-0 top-0 z-40 flex h-full w-80 flex-col border-l border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-2xl";
  return (
    <aside className={shell} style={p.style}>
      <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
          {p.readOnly ? `Instructor comments (${p.serverLive.length})` : `Feedback (${p.annotations.length})`}
        </h2>
        <button
          className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          onClick={p.onClose}
        >
          Close
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {p.annotations.length === 0 &&
          p.serverLive.length === 0 &&
          p.serverStale.length === 0 && (
            <p className="p-4 text-center text-xs text-stone-400 dark:text-stone-500">
              {p.readOnly
                ? "No comments on this submission."
                : "Select text in any view or add a general comment."}
            </p>
          )}
        {p.annotations.map((a) => (
          <AnnotationCard
            key={a.id}
            a={a}
            onOpen={p.onCardClick ? () => p.onCardClick!(a) : undefined}
            onDelete={editingId === null ? () => p.onRemove(a.id) : undefined}
            editing={editingId === a.id}
            draft={editingId === a.id ? draft : undefined}
            onEditStart={editingId === null ? () => { setEditingId(a.id); setDraft(a.comment); } : undefined}
            onEditChange={setDraft}
            onEditSave={() => { if (draft.trim()) { p.onEdit(a.id, draft.trim()); setEditingId(null); } }}
            onEditCancel={() => setEditingId(null)}
            saveAction={
              p.hosted ? (
                <div className="mt-1.5 flex items-center gap-2 border-t border-stone-100 dark:border-stone-800 pt-1.5">
                  <button
                    className="rounded-md bg-stone-900 dark:bg-stone-200 px-2 py-1 text-[11px] font-semibold text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400 disabled:opacity-40"
                    disabled={!p.reviewer.trim() || p.savingIds.has(a.id) || editingId !== null}
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onSaveHosted(a);
                    }}
                  >
                    {p.savingIds.has(a.id) ? "Saving…" : "Save"}
                  </button>
                  {!p.canEditSent && (
                    <span className="text-[10px] text-stone-400 dark:text-stone-500">
                      Comments can’t be edited or deleted once sent.
                    </span>
                  )}
                </div>
              ) : undefined
            }
          />
        ))}
        {(p.hosted || p.readOnly) && p.serverLive.length > 0 && (
          <div className={p.readOnly ? "" : "pt-2"}>
            {!p.readOnly && (
              <h3 className="px-0.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
                Sent
              </h3>
            )}
            <div className="space-y-2">
              {p.serverLive.map((c) => {
                // Card id = server id, the id its highlight paints under.
                const a = { ...c.annotation, id: c.id } as Annotation;
                const editable = !!(p.canEditSent && p.onEditSent && p.onDeleteSent);
                const idle = editingId === null && sentBusy === null;
                return (
                  <AnnotationCard
                    key={c.id}
                    a={a}
                    sentBy={c.author}
                    editedAt={c.editedAt}
                    onOpen={p.onCardClick ? () => p.onCardClick!(a) : undefined}
                    onDelete={editable && idle ? () => { setSentError(null); setConfirmSentDelete(c.id); } : undefined}
                    editing={editingId === c.id}
                    draft={editingId === c.id ? draft : undefined}
                    onEditStart={
                      editable && idle
                        ? () => { setSentError(null); setConfirmSentDelete(null); setEditingId(c.id); setDraft(a.comment); }
                        : undefined
                    }
                    onEditChange={setDraft}
                    onEditSave={async () => {
                      const text = draft.trim();
                      if (!text || sentBusy) return;
                      setSentBusy(c.id);
                      const ok = await p.onEditSent!(c.id, text);
                      setSentBusy(null);
                      if (ok) setEditingId(null);
                      else setSentError({ id: c.id, msg: "Couldn’t save the change — try again." });
                    }}
                    onEditCancel={() => setEditingId(null)}
                    saveAction={
                      confirmSentDelete === c.id || sentError?.id === c.id ? (
                        <div
                          className="mt-1.5 flex items-center gap-2 border-t border-stone-100 dark:border-stone-800 pt-1.5 text-[11px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {sentError?.id === c.id && (
                            <span role="alert" className="mr-auto text-red-700 dark:text-red-400">{sentError.msg}</span>
                          )}
                          {confirmSentDelete === c.id && (
                            <>
                              <span className="mr-auto text-stone-600 dark:text-stone-300">
                                Delete this comment? The student will no longer see it.
                              </span>
                              <button
                                className="rounded px-2 py-0.5 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                                onClick={() => setConfirmSentDelete(null)}
                              >
                                Cancel
                              </button>
                              <button
                                className="rounded bg-red-600 px-2 py-0.5 font-medium text-white hover:bg-red-700 disabled:opacity-40"
                                disabled={sentBusy !== null}
                                onClick={async () => {
                                  setSentBusy(c.id);
                                  const ok = await p.onDeleteSent!(c.id);
                                  setSentBusy(null);
                                  setConfirmSentDelete(null);
                                  if (!ok) setSentError({ id: c.id, msg: "Couldn’t delete — try again." });
                                }}
                              >
                                {sentBusy === c.id ? "Deleting…" : "Delete"}
                              </button>
                            </>
                          )}
                        </div>
                      ) : undefined
                    }
                  />
                );
              })}
            </div>
          </div>
        )}
        {(p.hosted || p.readOnly) && p.serverStale.length > 0 && (
          <div className="pt-2">
            <h3 className="px-0.5 pb-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
              Written before the board was last updated — the student still
              has a copy of all comments
            </h3>
            <div className="space-y-2">
              {p.serverStale.map((c) => (
                <AnnotationCard
                  key={c.id}
                  a={c.annotation}
                  sentBy={c.author}
                  stale
                />
              ))}
            </div>
          </div>
        )}
      </div>
      {!p.readOnly && (
      <div className="border-t border-stone-200 dark:border-stone-800 p-3">
        {p.submitState === "failed" && (
          <div className="mb-2 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-2 text-xs text-red-800 dark:text-red-300">
            Could not reach the board server (it may have exited).{" "}
            <button className="font-medium underline disabled:opacity-40" onClick={p.onCopyFallback} disabled={editingId !== null}>
              Copy feedback as markdown
            </button>{" "}
            and paste it into your session instead.
          </div>
        )}
        {p.canPost ? (
          <div className="space-y-2">
            <button
              className="w-full rounded-md bg-stone-900 dark:bg-stone-200 py-2 text-sm font-semibold text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400 disabled:opacity-40"
              disabled={
                p.annotations.length === 0 ||
                p.submitState === "sending" ||
                editingId !== null
              }
              onClick={p.onSubmit}
            >
              {p.submitState === "sending" ? "Sending…" : "Send to Claude"}
            </button>
          </div>
        ) : p.hosted ? (
          <div className="space-y-2">
            <input
              className="w-full rounded-md border border-stone-300 dark:border-stone-600 px-2 py-1.5 text-sm"
              placeholder="Your name (shown on your comments)"
              value={p.reviewer}
              onChange={(e) => p.onReviewerChange(e.target.value)}
              maxLength={120}
            />
            <p className="text-[11px] text-stone-500">
              Names are self-entered and not verified.
            </p>
            {!p.reviewer.trim() && p.annotations.length > 0 && (
              <p className="text-[11px] text-stone-500">
                Enter your name to save comments below.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <input
              className="w-full rounded-md border border-stone-300 dark:border-stone-600 px-2 py-1.5 text-sm"
              placeholder="Your name (for attribution)"
              value={p.reviewer}
              onChange={(e) => p.onReviewerChange(e.target.value)}
            />
            {p.submitState === "downloaded" && (
              <p className="rounded-md border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950 p-2 text-[11px] text-green-800 dark:text-green-300">
                Feedback file downloaded — email it back to the student. You
                can keep annotating and download again.
              </p>
            )}
            <button
              className="w-full rounded-md bg-stone-900 dark:bg-stone-200 py-2 text-sm font-semibold text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400 disabled:opacity-40"
              disabled={p.annotations.length === 0 || editingId !== null}
              onClick={p.onDownload}
            >
              Download feedback file
            </button>
            <button
              className="block w-full text-center text-[11px] text-stone-500 underline hover:text-stone-700 disabled:opacity-40"
              onClick={p.onCopyFallback}
              disabled={editingId !== null}
            >
              or copy feedback to clipboard
            </button>
          </div>
        )}
      </div>
      )}
    </aside>
  );
}
