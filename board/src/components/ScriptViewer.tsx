import { useContext, useState } from "react";
import { SentIdsContext } from "../lib/sentIds";
import type { BoardFile, ScriptCommentAnnotation } from "../lib/types";

/** Line-numbered script snapshot with line-range comments. Text-selection
 * anchoring (anchor.ts) is for prose; scripts anchor by line number. Saved
 * comments render as line-range highlights carrying data-annotation, so the
 * app-level click-sync delegation reaches them like any prose mark. */
export default function ScriptViewer({
  file,
  canAnnotate,
  onAddLineComment,
  saved = [],
}: {
  file: BoardFile;
  canAnnotate: boolean;
  onAddLineComment: (
    lineStart: number,
    lineEnd: number,
    excerpt: string,
    comment: string,
  ) => void;
  saved?: ScriptCommentAnnotation[];
}) {
  const sentIds = useContext(SentIdsContext);
  const lines = file.content.replace(/\n$/, "").split("\n");
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [text, setText] = useState("");

  const lo = selStart !== null && selEnd !== null ? Math.min(selStart, selEnd) : null;
  const hi = selStart !== null && selEnd !== null ? Math.max(selStart, selEnd) : null;

  const clickLine = (n: number, shift: boolean) => {
    if (!canAnnotate) return;
    if (shift && selStart !== null) {
      setSelEnd(n);
    } else {
      setSelStart(n);
      setSelEnd(n);
    }
  };

  const save = () => {
    if (lo === null || hi === null || !text.trim()) return;
    onAddLineComment(
      lo,
      hi,
      lines.slice(lo - 1, hi).join("\n").slice(0, 500),
      text.trim(),
    );
    setSelStart(null);
    setSelEnd(null);
    setText("");
  };

  return (
    <div className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
      <div className="flex items-center justify-between border-b border-stone-100 dark:border-stone-800 px-3 py-1.5">
        <span className="font-mono text-xs text-stone-600 dark:text-stone-400">
          {file.path.split("/results/")[1] ?? file.path}
        </span>
        {canAnnotate && (
          <span className="text-[11px] text-stone-400 dark:text-stone-500">
            click or press Enter on a line (Shift extends) to comment
          </span>
        )}
      </div>
      <pre className="max-h-96 overflow-auto p-0 text-xs leading-5">
        {lines.map((ln, i) => {
          const n = i + 1;
          const selected = lo !== null && hi !== null && n >= lo && n <= hi;
          const savedHit = saved.find((s) => n >= s.lineStart && n <= s.lineEnd);
          const savedAnchor = savedHit && n === savedHit.lineStart ? savedHit : null;
          return (
            <div
              key={n}
              className={`flex px-0 ${canAnnotate ? "cursor-pointer" : ""} ${
                selected
                  ? "bg-amber-100 dark:bg-amber-900/40"
                  : savedHit
                    ? "bg-amber-50 dark:bg-amber-950/60"
                    : "hover:bg-stone-50 dark:hover:bg-stone-800/60"
              }`}
              onClick={(e) => {
                // A click on an annotated gutter opens the card via the
                // app-level [data-annotation] delegation — not a selection.
                if ((e.target as HTMLElement).closest?.("[data-annotation]")) return;
                clickLine(n, e.shiftKey);
              }}
            >
              <span
                className={`w-10 shrink-0 select-none border-r border-stone-100 dark:border-stone-800 pr-2 text-right ${
                  savedHit && n === savedHit.lineStart
                    ? "cursor-pointer font-semibold text-amber-600 dark:text-amber-400"
                    : "text-stone-400 dark:text-stone-500"
                }`}
                data-annotation={
                  savedAnchor ? savedAnchor.id : undefined
                }
                data-kind={
                  savedAnchor ? (sentIds.has(savedAnchor.id) ? "sent" : "draft") : undefined
                }
                role={canAnnotate || savedAnchor ? "button" : undefined}
                tabIndex={canAnnotate || savedAnchor ? 0 : undefined}
                aria-label={
                  savedAnchor
                    ? `Open comment on line ${n}`
                    : canAnnotate
                      ? `Select line ${n} for comment`
                      : undefined
                }
                onKeyDown={(e) => {
                  if (savedAnchor && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    // Enter bubbles to App's delegated annotation handler.
                    // Space has no delegated key behavior, so emit the same
                    // bubbling click that pointer activation uses.
                    if (e.key === " ") e.currentTarget.click();
                    return;
                  }
                  if (canAnnotate && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    e.stopPropagation();
                    clickLine(n, e.shiftKey);
                  }
                }}
                title={
                  savedAnchor ? "Open this line comment" : undefined
                }
              >
                {n}
              </span>
              <code className="whitespace-pre pl-3">{ln || " "}</code>
            </div>
          );
        })}
      </pre>
      {canAnnotate && lo !== null && hi !== null && (
        <div
          data-reload-guard=""
          className="border-t border-stone-200 dark:border-stone-800 p-2"
        >
          <div className="mb-1 text-[11px] text-stone-500">
            Comment on lines {lo}
            {hi !== lo ? `–${hi}` : ""}
          </div>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-16 w-full resize-none rounded border border-stone-200 dark:border-stone-800 p-2 text-sm outline-none focus:border-stone-400 dark:focus:border-stone-500"
            placeholder="Your comment on these lines…"
          />
          <div className="mt-1 flex justify-end gap-2">
            <button
              className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
              onClick={() => {
                setSelStart(null);
                setSelEnd(null);
                setText("");
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
