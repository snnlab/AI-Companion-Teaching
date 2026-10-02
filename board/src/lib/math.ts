import katex from "katex";
import type { MarkedExtension, TokenizerAndRendererExtension } from "marked";

// Math in manuscripts (v0.12). Recognized delimiters, the pandoc/MathJax set:
//   display  $$ … $$   \[ … \]   (may span lines, may sit inside a paragraph)
//   inline   $ … $     \( … \)
// The inline-$ rule is pandoc's, so prose dollar amounts stay prose: the
// opening $ must be followed by a non-space, the closing $ preceded by a
// non-space and not followed by a digit ("costs $5 to $10" is not math).
// `\$` is a literal dollar (marked's escape rule). Code spans/blocks are
// tokenized by marked before these rules ever see their contents.
//
// Rendering: KaTeX MathML-only output — browsers lay MathML out natively, so
// the single-file board needs no KaTeX CSS or font payload. trust:false (the
// default) keeps \href/\htmlClass & co. disabled, so the HTML policy in
// Markdown.tsx still holds: nothing executable reaches innerHTML. A parse
// error renders the source in red rather than throwing.
//
// KaTeX embeds the TeX source as an <annotation> inside <semantics>. It is
// stripped (and kept on data-tex instead) because the comment-anchoring code
// works on the container's textContent — a hidden copy of the source would
// sit between the visible words and break quote matching.

const ANNOTATION_RE = /<annotation encoding="application\/x-tex">[\s\S]*?<\/annotation>/g;

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderMath(tex: string, displayMode: boolean): string {
  const html = katex
    .renderToString(tex, { displayMode, output: "mathml", throwOnError: false, strict: "ignore" })
    .replace(ANNOTATION_RE, "");
  // Always a <span> (display math is display:block via CSS): $$…$$ may sit
  // mid-paragraph, and a <div> inside <p> would be torn apart by the parser.
  const cls = displayMode ? "math math-display" : "math math-inline";
  return `<span class="${cls}" data-tex="${escapeAttr(tex.trim())}">${html}</span>`;
}

type MathToken = { type: string; raw: string; text: string };

// Block-level display math: a paragraph that is only $$…$$ or \[…\].
const blockMath: TokenizerAndRendererExtension = {
  name: "mathBlock",
  level: "block",
  start(src: string) {
    const m = src.match(/^ {0,3}(\$\$|\\\[)/m);
    return m?.index;
  },
  tokenizer(src: string) {
    const m =
      /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src) ??
      /^ {0,3}\\\[([\s\S]+?)\\\][ \t]*(?:\n+|$)/.exec(src);
    if (!m) return undefined;
    return { type: "mathBlock", raw: m[0], text: m[1] };
  },
  renderer(token) {
    return renderMath((token as MathToken).text, true) + "\n";
  },
};

const inlineMath: TokenizerAndRendererExtension = {
  name: "mathInline",
  level: "inline",
  start(src: string) {
    const m = src.match(/\$|\\[([]/);
    return m?.index;
  },
  tokenizer(src: string) {
    let m = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (m) return { type: "mathInline", raw: m[0], text: m[1], display: true };
    m = /^\\\[([\s\S]+?)\\\]/.exec(src);
    if (m) return { type: "mathInline", raw: m[0], text: m[1], display: true };
    m = /^\\\(([\s\S]+?)\\\)/.exec(src);
    if (m) return { type: "mathInline", raw: m[0], text: m[1], display: false };
    m = /^\$(?![\s$])((?:\\.|[^\\$])+?)(?<!\s)\$(?!\d)/.exec(src);
    if (m) return { type: "mathInline", raw: m[0], text: m[1], display: false };
    return undefined;
  },
  renderer(token) {
    const t = token as MathToken & { display: boolean };
    return renderMath(t.text, t.display);
  },
};

export const mathExtension: MarkedExtension = { extensions: [blockMath, inlineMath] };

// Display-math delimiter lines, for unwrapSoftBreaks: a block opened by a bare
// `$$` / `\[` line keeps its line structure (like a code fence).
export const MATH_FENCE_OPEN_RE = /^\s*(\$\$|\\\[)\s*$/;
export const MATH_FENCE_CLOSE_RE = /^\s*(\$\$|\\\])\s*$/;
