import { memo, useMemo } from "react";
import { Marked } from "marked";
import { unwrapSoftBreaks } from "../lib/markdownText";

// HTML policy: comments are stripped; any other raw HTML in artifacts is
// ESCAPED, never executed — a committed/shared board.html must be inert even
// if an artifact contains injected markup.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// Links: allowlist http/https/mailto/#fragment; javascript:, data:, file:,
// other schemes, and relative paths (which cannot resolve on the board)
// render as their inner text — the same "the board never follows a URL the
// payload didn't provide" contract images obey. Pre-existing hole: marked's
// default renderer emitted javascript: hrefs into dangerouslySetInnerHTML.
const SAFE_LINK_RE = /^(https?:|mailto:)/i;

// marked percent-encodes hrefs ("my fig.png" -> "my%20fig.png"); asset maps
// are keyed by the href as the author wrote it.
function safeDecode(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

// breaks: true — research plans and reports are written line-oriented
// (Serves:, Success:, sign-off lines); single newlines must render as breaks.
// Hard-wrapped paragraphs are soft-unwrapped BEFORE parsing (v0.11), so
// sentence continuations flow to the container width while the intentional
// line-oriented breaks above survive. See lib/markdownText.ts.
function makeMarked(assets?: Record<string, string>) {
  return new Marked({
    gfm: true,
    breaks: true,
    renderer: {
      html({ text }: { text: string }) {
        const t = text.trim();
        if (t.startsWith("<!--")) return "";
        return escapeHtml(text);
      },
      link(
        this: { parser: { parseInline(t: unknown): string } },
        { href, title, tokens }: { href: string; title?: string | null; tokens: unknown },
      ) {
        const inner = this.parser.parseInline(tokens);
        if (href.startsWith("#")) {
          return `<a href="${escapeAttr(href)}"${title ? ` title="${escapeAttr(title)}"` : ""}>${inner}</a>`;
        }
        if (!SAFE_LINK_RE.test(href)) return inner;
        return `<a href="${escapeAttr(href)}"${
          title ? ` title="${escapeAttr(title)}"` : ""
        } target="_blank" rel="noopener noreferrer">${inner}</a>`;
      },
      // Reports embed figures by repo-relative path; resolve ONLY against the
      // payload's assets — exact href first (the manuscript's map), then
      // basename (a results bundle's map; same contract as artifactDisplay's
      // assetUrl). Anything unresolved renders as text — the board never
      // fetches an image URL the payload did not provide.
      ...(assets
        ? {
            image({ href, title, text }: { href: string; title: string | null; text: string }) {
              const resolved =
                assets[href] ?? assets[safeDecode(href)] ?? assets[href.split("/").pop() ?? ""];
              if (!resolved) return escapeHtml(text || href);
              return `<img src="${escapeAttr(resolved)}" alt="${escapeAttr(text)}"${
                title ? ` title="${escapeAttr(title)}"` : ""
              } class="max-w-full" loading="lazy">`;
            },
          }
        : {}),
    },
  });
}

const defaultMarked = makeMarked();

// Memoized: a plan body renders through many <Markdown> blocks, and the board
// re-renders frequently (3s health poll, drawer/annotation state). Without memo,
// each re-render recreates the dangerouslySetInnerHTML payload and React
// re-commits the innerHTML — which tears out any <mark> highlights AnnotationLayer
// injected imperatively into this DOM. Skipping re-render when `source` is
// unchanged keeps those highlights alive; a genuine source change still
// re-renders and the paint pass repaints.
function Markdown({
  source,
  className = "",
  assets,
}: {
  source: string;
  className?: string;
  assets?: Record<string, string>;
}) {
  const html = useMemo(() => {
    const m = assets ? makeMarked(assets) : defaultMarked;
    return m.parse(unwrapSoftBreaks(source)) as string;
  }, [source, assets]);
  return (
    <div
      className={`prose-md ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default memo(Markdown);
