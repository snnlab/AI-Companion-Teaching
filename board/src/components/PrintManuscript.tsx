// Print / Save as PDF for the manuscript (v0.13). A clean copy of the
// manuscript — no board chrome — is rendered into #print-root, a direct child
// of <body>; the print stylesheet (index.css, @media print) hides everything
// else. The browser's own print dialog does the rest, "Save as PDF" included.
// With comments on, each highlight gets a [n] marker and the comments are
// listed after the text, Word-style.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Markdown from "./Markdown";
import DocxHtml from "./DocxHtml";
import { paintHighlights } from "../lib/anchor";
import { fmtDate } from "../lib/fmtDate";
import type { Annotation, DocCommentAnnotation, ManuscriptFile } from "../lib/types";

const NO_ASSETS: Record<string, string> = {};

export interface PrintComment {
  a: DocCommentAnnotation | Extract<Annotation, { type: "general" }>;
  author?: string;
  at?: string;
}

function waitForImages(root: HTMLElement, timeoutMs = 4000): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));
  for (const img of imgs) img.loading = "eager"; // lazy images in a hidden copy never load
  const pending = imgs.filter((img) => !img.complete);
  if (pending.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let left = pending.length;
    const done = () => {
      left -= 1;
      if (left <= 0) resolve();
    };
    for (const img of pending) {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    }
    setTimeout(resolve, timeoutMs);
  });
}

export default function PrintManuscript({
  manuscript,
  title,
  subtitle,
  comments,
  includeComments,
  onDone,
}: {
  manuscript: ManuscriptFile;
  title: string;
  subtitle: string;
  comments: PrintComment[];
  includeComments: boolean;
  onDone: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // Comment ids in the order their highlights appear in the text.
  const [numbered, setNumbered] = useState<string[]>([]);

  // Paint + number the highlights in the print copy before the dialog opens.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || !includeComments) return;
    const anchored = comments.filter((c): c is PrintComment & { a: DocCommentAnnotation } => c.a.type === "doc-comment");
    paintHighlights(
      el,
      // No scope: the print copy holds only the manuscript, so the whole
      // container is the search space.
      anchored.map((c) => ({ id: c.a.id, quote: c.a.quote, occurrenceIndex: c.a.occurrenceIndex })),
    );
    const order: string[] = [];
    const lastMark = new Map<string, Element>();
    el.querySelectorAll("mark[data-annotation]").forEach((m) => {
      const id = m.getAttribute("data-annotation") as string;
      if (!order.includes(id)) order.push(id);
      lastMark.set(id, m);
    });
    order.forEach((id, i) => {
      const sup = document.createElement("sup");
      sup.className = "print-ref";
      sup.textContent = `[${i + 1}]`;
      lastMark.get(id)?.after(sup);
    });
    setNumbered(order);
  }, [comments, includeComments]);

  useEffect(() => {
    let cancelled = false;
    const finish = () => {
      if (!cancelled) onDone();
    };
    window.addEventListener("afterprint", finish, { once: true });
    const el = bodyRef.current?.parentElement;
    (el ? waitForImages(el) : Promise.resolve()).then(() => {
      if (cancelled) return;
      try {
        window.print();
      } finally {
        // Some browsers never fire afterprint; print() returning is enough.
        setTimeout(finish, 0);
      }
    });
    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", finish);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Comments in reading order: numbered (anchored, in text order) first,
  // then the ones whose passage was not found, then general notes.
  const byId = new Map(comments.map((c) => [c.a.id, c]));
  const order = includeComments
    ? [
        ...numbered.map((id) => byId.get(id)).filter((c): c is PrintComment => !!c),
        ...comments.filter((c) => !numbered.includes(c.a.id) && c.a.type !== "general"),
        ...comments.filter((c) => c.a.type === "general"),
      ]
    : [];

  return createPortal(
    <div id="print-root" data-testid="print-root">
      <header className="print-head">
        <div className="print-title">{title}</div>
        <div className="print-sub">{subtitle}</div>
      </header>
      <div ref={bodyRef}>
        {manuscript.format === "docx-html" ? (
          <DocxHtml html={manuscript.content} assets={manuscript.assets ?? NO_ASSETS} />
        ) : (
          <Markdown source={manuscript.content} assets={manuscript.assets ?? NO_ASSETS} math />
        )}
      </div>
      {includeComments && order.length > 0 && (
        <section className="print-comments">
          <h2>Comments</h2>
          <ol>
            {order.map((c) => {
              const n = numbered.indexOf(c.a.id);
              const quote = c.a.type === "doc-comment" ? c.a.quote : "";
              return (
                <li key={c.a.id}>
                  <div className="print-c-meta">
                    {n >= 0 ? `[${n + 1}] ` : c.a.type === "general" ? "General comment · " : "Passage not found · "}
                    {[c.author, c.at ? fmtDate(c.at) : ""].filter(Boolean).join(" · ")}
                  </div>
                  {quote && <blockquote>{quote}</blockquote>}
                  <div className="print-c-body">{c.a.comment}</div>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>,
    document.body,
  );
}
