// Quote-based annotation anchoring.
// Anchors store: the quoted text, 32 chars of prefix/suffix context, the nearest
// section heading, and the occurrence index of the quote within that section's
// rendered text. Re-painting walks rendered text nodes; anchors that cannot be
// matched are preserved as "unanchored" (never dropped).

const CONTEXT_CHARS = 32;

export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export interface SelectionAnchor {
  quote: string;
  prefix: string;
  suffix: string;
  sectionHeading: string;
  scope: string; // data-annot-scope of the stamped element, "" when unscoped
  occurrenceIndex: number;
}

/** Build an anchor from the current window selection, scoped to a container. */
export function anchorFromSelection(
  container: HTMLElement,
): SelectionAnchor | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  const quote = normalizeWs(sel.toString());
  if (!quote || quote.length < 2) return null;

  // Section heading: nearest previous h1/h2/h3 in document order.
  let sectionHeading = "";
  let node: Node | null = range.startContainer;
  const el =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  let cur: Element | null = el;
  outer: while (cur && cur !== container) {
    let sib: Element | null = cur.previousElementSibling;
    while (sib) {
      if (/^H[1-3]$/.test(sib.tagName)) {
        sectionHeading = normalizeWs(sib.textContent ?? "");
        break outer;
      }
      const inner = sib.querySelectorAll("h1,h2,h3");
      if (inner.length > 0) {
        sectionHeading = normalizeWs(inner[inner.length - 1].textContent ?? "");
        break outer;
      }
      sib = sib.previousElementSibling;
    }
    cur = cur.parentElement;
  }

  // Element stamps: nearest ancestor with data-annot-scope wins over the
  // heading walk, and occurrence is counted within that element.
  let scope = "";
  let scopeEl: HTMLElement | null = null;
  for (let e: Element | null = el; e && e !== container; e = e.parentElement) {
    const s = (e as HTMLElement).dataset?.annotScope;
    if (s !== undefined) {
      scope = s;
      scopeEl = e as HTMLElement;
      const label = (e as HTMLElement).dataset?.annotSection;
      if (label) sectionHeading = label;
      break;
    }
  }

  // Occurrence index + prefix/suffix within the scoped element's text (or the
  // container's when unscoped, or when the selection spans outside the stamp).
  let root: HTMLElement = scopeEl ?? container;
  let full = normalizeWs(root.textContent ?? "");
  if (scopeEl && !full.includes(quote)) {
    scope = "";
    root = container;
    full = normalizeWs(container.textContent ?? "");
  }
  const positions: number[] = [];
  let idx = full.indexOf(quote);
  while (idx !== -1) {
    positions.push(idx);
    idx = full.indexOf(quote, idx + 1);
  }
  // Locate THIS selection by comparing preceding text length.
  const preRange = document.createRange();
  preRange.selectNodeContents(root);
  preRange.setEnd(range.startContainer, range.startOffset);
  const preLen = normalizeWs(preRange.toString()).length;
  let occurrenceIndex = 0;
  let best = Infinity;
  positions.forEach((p, i) => {
    const d = Math.abs(p - preLen);
    if (d < best) {
      best = d;
      occurrenceIndex = i;
    }
  });
  const pos = positions[occurrenceIndex] ?? -1;
  const prefix =
    pos >= 0 ? full.slice(Math.max(0, pos - CONTEXT_CHARS), pos) : "";
  const suffix =
    pos >= 0 ? full.slice(pos + quote.length, pos + quote.length + CONTEXT_CHARS) : "";

  return { quote, prefix, suffix, sectionHeading, scope, occurrenceIndex };
}

export interface PaintOutcome {
  painted: Set<string>;
  scopeAbsent: Set<string>; // anchors whose scope element is not in the DOM
}

/**
 * Paint highlights for anchors inside a rendered container. Anchors with a
 * scope are searched only inside matching [data-annot-scope] elements;
 * scopeless anchors keep container-wide matching. Anchors whose scope element
 * is absent (e.g., hidden by a filter) are reported, not treated as unanchored.
 */
export function paintHighlights(
  container: HTMLElement,
  anchors: {
    id: string;
    quote: string;
    occurrenceIndex: number;
    scope?: string;
    // "sent" = already on the server; "draft" = a local pending comment.
    // Stamped as data-kind so CSS can tell them apart.
    kind?: "sent" | "draft";
  }[],
): PaintOutcome {
  clearHighlights(container);
  const painted = new Set<string>();
  const scopeAbsent = new Set<string>();
  const scopeEls = new Map<string, HTMLElement[]>();
  container.querySelectorAll<HTMLElement>("[data-annot-scope]").forEach((el) => {
    const key = el.dataset.annotScope ?? "";
    const list = scopeEls.get(key);
    if (list) list.push(el);
    else scopeEls.set(key, [el]);
  });
  for (const a of anchors) {
    if (!a.quote.trim()) continue; // unanchored (e.g. a global plan comment) — nothing to paint
    if (a.scope) {
      const els = scopeEls.get(a.scope);
      if (!els) {
        scopeAbsent.add(a.id);
        continue;
      }
      // Duplicate scope ids are possible (twin timeline events); paint in the
      // first element where the anchor resolves.
      for (const el of els) {
        if (paintOne(el, a)) {
          painted.add(a.id);
          break;
        }
      }
    } else if (paintOne(container, a)) {
      painted.add(a.id);
    }
  }
  return { painted, scopeAbsent };
}

export function clearHighlights(container: HTMLElement): void {
  container.querySelectorAll("mark[data-annotation]").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

function paintOne(
  container: HTMLElement,
  a: { id: string; quote: string; occurrenceIndex: number; kind?: "sent" | "draft" },
): boolean {
  // Walk text nodes accumulating normalized text; find the nth occurrence of
  // the quote; wrap the covered range(s) in <mark>.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);

  // Build a normalized concatenation with a map back to (node, offset).
  let norm = "";
  const map: { node: Text; offset: number }[] = [];
  let lastWasSpace = true;
  for (const n of nodes) {
    const text = n.data;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (/\s/.test(ch)) {
        if (!lastWasSpace) {
          norm += " ";
          map.push({ node: n, offset: i });
          lastWasSpace = true;
        }
      } else {
        norm += ch;
        map.push({ node: n, offset: i });
        lastWasSpace = false;
      }
    }
  }

  const positions: number[] = [];
  let idx = norm.indexOf(a.quote);
  while (idx !== -1) {
    positions.push(idx);
    idx = norm.indexOf(a.quote, idx + 1);
  }
  const start = positions[a.occurrenceIndex] ?? positions[0];
  if (start === undefined) return false;
  const end = start + a.quote.length - 1;
  if (!map[start] || !map[end]) return false;

  try {
    const range = document.createRange();
    range.setStart(map[start].node, map[start].offset);
    range.setEnd(map[end].node, map[end].offset + 1);
    // surroundContents fails across element boundaries; extract/wrap instead.
    const mark = document.createElement("mark");
    mark.setAttribute("data-annotation", a.id);
    if (a.kind) mark.setAttribute("data-kind", a.kind);
    mark.setAttribute("tabindex", "0");
    range.surroundContents(mark);
    return true;
  } catch {
    // Selection spans element boundaries (e.g., across table cells) —
    // fall back to marking each covered text node segment.
    try {
      const startNode = map[start].node;
      const endNode = map[end].node;
      const covered = nodes.filter((n) => {
        const afterStart =
          nodes.indexOf(n) >= nodes.indexOf(startNode);
        const beforeEnd = nodes.indexOf(n) <= nodes.indexOf(endNode);
        return afterStart && beforeEnd;
      });
      for (const n of covered) {
        const from = n === startNode ? map[start].offset : 0;
        const to = n === endNode ? map[end].offset + 1 : n.data.length;
        if (to <= from) continue;
        const r = document.createRange();
        r.setStart(n, from);
        r.setEnd(n, to);
        const mark = document.createElement("mark");
        mark.setAttribute("data-annotation", a.id);
        if (a.kind) mark.setAttribute("data-kind", a.kind);
        mark.setAttribute("tabindex", "0");
        r.surroundContents(mark);
      }
      return true;
    } catch {
      return false;
    }
  }
}
