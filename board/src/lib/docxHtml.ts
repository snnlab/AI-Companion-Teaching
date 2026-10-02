// Word manuscripts arrive as HTML (board.py's _docx_to_html, v0.13). That
// HTML comes out of a student's payload — on the classroom roster a forged
// submission could carry anything — so it is never trusted: it is parsed
// inert (a <template> neither runs scripts nor loads images) and REBUILT from
// an allowlist of tags, attributes and class tokens. Everything else is
// dropped: unknown elements are unwrapped (their text kept), script-like
// ones removed with their content, every event handler and style attribute
// discarded. Figures resolve only through the payload's own assets map, the
// same contract Markdown.tsx's image renderer keeps.
import { renderMath } from "./math";

const TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "u", "s", "sup", "sub", "br",
  "div", "table", "colgroup", "col", "thead", "tbody", "tr", "th", "td",
  "ul", "ol", "li", "a", "img", "span", "section", "blockquote",
]);
// Removed together with everything inside them.
const DROP = new Set(["script", "style", "template", "iframe", "object", "embed", "noscript", "svg", "math", "head", "title"]);
const VOID = new Set(["br", "col", "img"]);
const CLASSES = new Set([
  "ac", "ar", "caption", "tbl", "bt", "bb", "bl", "br", "sh", "fig", "fig-missing", "math", "fn", "footnotes",
]);
const SAFE_HREF_RE = /^(https?:|mailto:)/i;
const NOTE_HREF_RE = /^#fn-\d{1,4}$/;
const NOTE_ID_RE = /^fn(ref)?-\d{1,4}$/;
const WIDTH_RE = /^width:\d{1,3}(\.\d{1,2})?%$/;
const SAFE_SRC_RE = /^(data:image\/|blob:|\/artifact\/)/i;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
function intIn(v: string | null, lo: number, hi: number): number | null {
  if (v === null || !/^\d{1,5}$/.test(v)) return null;
  const n = Number(v);
  return n >= lo && n <= hi ? n : null;
}

function attrsFor(el: Element, tag: string, assets: Record<string, string>): string | null {
  let out = "";
  const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter((c) => CLASSES.has(c));
  const add = (k: string, v: string | number) => {
    out += ` ${k}="${escapeAttr(String(v))}"`;
  };
  switch (tag) {
    case "td":
    case "th": {
      const cs = intIn(el.getAttribute("colspan"), 2, 1000);
      const rs = intIn(el.getAttribute("rowspan"), 2, 10000);
      if (cs) add("colspan", cs);
      if (rs) add("rowspan", rs);
      break;
    }
    case "col": {
      const st = (el.getAttribute("style") ?? "").trim();
      if (WIDTH_RE.test(st)) add("style", st);
      break;
    }
    case "ol": {
      const t = el.getAttribute("type");
      if (t && ["1", "a", "A", "i", "I"].includes(t)) add("type", t);
      const st = intIn(el.getAttribute("start"), 0, 100000);
      if (st !== null) add("start", st);
      break;
    }
    case "li":
    case "a": {
      if (tag === "a") {
        const href = el.getAttribute("href") ?? "";
        if (NOTE_HREF_RE.test(href)) add("href", href);
        else if (SAFE_HREF_RE.test(href)) {
          add("href", href);
          out += ' target="_blank" rel="noopener noreferrer"';
        }
      }
      const id = el.getAttribute("id");
      if (id && NOTE_ID_RE.test(id)) add("id", id);
      break;
    }
    case "img": {
      const key = el.getAttribute("src") ?? "";
      const src = Object.prototype.hasOwnProperty.call(assets, key) ? assets[key] : undefined;
      if (!src || !SAFE_SRC_RE.test(src)) return null; // unresolved: caller shows the alt text
      add("src", src);
      add("alt", el.getAttribute("alt") ?? "");
      const w = intIn(el.getAttribute("width"), 1, 4000);
      const h = intIn(el.getAttribute("height"), 1, 8000);
      if (w && h) {
        add("width", w);
        add("height", h);
      }
      out += ' loading="lazy"';
      break;
    }
  }
  if (cls.length) add("class", cls.join(" "));
  return out;
}

function serialize(node: Node, assets: Record<string, string>): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return ""; // comments, PIs
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (DROP.has(tag)) return "";
  const kids = () => Array.from(el.childNodes, (c) => serialize(c, assets)).join("");
  if (!TAGS.has(tag)) return kids();
  if (tag === "span" && el.classList.contains("math")) {
    const tex = el.getAttribute("data-tex") ?? "";
    return tex ? renderMath(tex, el.getAttribute("data-display") === "1") : "";
  }
  const attrs = attrsFor(el, tag, assets);
  if (attrs === null) {
    // An image the payload cannot back: say so instead of a broken icon.
    const alt = el.getAttribute("alt");
    return `<span class="fig-missing">${escapeHtml(alt ? `[Figure: ${alt}]` : "[Figure not available]")}</span>`;
  }
  if (VOID.has(tag)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${kids()}</${tag}>`;
}

/** Allowlist-rebuilt HTML for a converted Word manuscript, equations typeset. */
export function sanitizeDocxHtml(html: string, assets: Record<string, string> = {}): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  return Array.from(tpl.content.childNodes, (n) => serialize(n, assets)).join("");
}
