// A4 page layout for the Manuscript tab (v0.16).
//
// The manuscript stays ONE continuous DOM (AnnotationLayer anchors comments
// by text, and the outline holds heading nodes), so pages are made without
// moving or splitting anything: a block that would cross the bottom margin
// gets extra margin-top so it starts at the next page's top margin, and the
// sheets themselves are drawn on a separate layer behind the text. Blocks
// move whole; a block taller than a page makes that page longer.
//
// The pages are the board's own A4 layout, not the student's Word pagination
// (board.py's docx conversion drops fonts, margins and spacing).

/** CSS px at 96 dpi: A4 is 210 x 297 mm; 1-inch margins. */
export const A4 = { width: 794, height: 1123, margin: 96, gap: 24 } as const;

/** A block's natural extent, measured with no page breaks applied. */
export interface Extent {
  top: number;
  bottom: number;
  /** Headings stay with the start of the block after them. */
  keepWithNext?: boolean;
}

export interface PageBox {
  top: number;
  height: number;
}

export interface PagePlan {
  pages: PageBox[];
  /** index into the extents -> how far that block moves down (px). */
  pushes: { index: number; delta: number }[];
  /** page number (1-based) of each block, same order as the extents. */
  pageOfBlock: number[];
}

const EPS = 0.5;
/** How much of the next block a heading must keep on its page. */
const KEEP_NEXT_PX = 48;

/** Greedy page fill over the natural layout. Pushing block i down by d moves
 *  every later block by d as well (plain block flow), so one running `shift`
 *  turns natural positions into laid-out ones. */
export function planPages(extents: Extent[], page = A4): PagePlan {
  const pages: PageBox[] = [];
  const pushes: { index: number; delta: number }[] = [];
  const pageOfBlock: number[] = [];
  let pageTop = 0;
  let lowest = 0; // lowest laid-out bottom on the current page
  let placed = 0; // blocks already on the current page
  let shift = 0;
  const bodyBottom = () => pageTop + page.height - page.margin;

  for (let i = 0; i < extents.length; i++) {
    const e = extents[i];
    const top = e.top + shift;
    let bottom = e.bottom + shift;
    if (e.keepWithNext && i + 1 < extents.length) {
      const n = extents[i + 1];
      bottom = Math.max(bottom, Math.min(n.bottom, n.top + KEEP_NEXT_PX) + shift);
    }
    if (bottom > bodyBottom() + EPS && placed > 0) {
      const end = Math.max(pageTop + page.height, lowest + page.margin);
      pages.push({ top: pageTop, height: end - pageTop });
      pageTop = end + page.gap;
      const delta = pageTop + page.margin - top;
      pushes.push({ index: i, delta });
      shift += delta;
      lowest = 0;
      placed = 0;
    }
    placed++;
    lowest = Math.max(lowest, e.bottom + shift);
    pageOfBlock.push(pages.length + 1);
  }
  const end = Math.max(pageTop + page.height, lowest + page.margin);
  pages.push({ top: pageTop, height: end - pageTop });
  return { pages, pushes, pageOfBlock };
}

const FLATTEN = new Set(["UL", "OL", "DL", "BLOCKQUOTE", "SECTION", "DIV", "ARTICLE"]);
const HEADING = /^H[1-6]$/;

/** The blocks pages are cut between: top-level children of `root`, with
 *  lists, quotes and plain wrappers opened up so a long list can break
 *  between items. Scrolling wrappers (a wide table, display math) stay whole. */
export function collectBlocks(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (parent: HTMLElement) => {
    for (const child of Array.from(parent.children) as HTMLElement[]) {
      if (child.dataset.pageSkip !== undefined) continue;
      const style = getComputedStyle(child);
      if (style.display === "none" || style.position === "absolute" || style.position === "fixed") continue;
      const open =
        FLATTEN.has(child.tagName) &&
        child.children.length > 0 &&
        style.overflowX === "visible" &&
        style.display !== "inline" &&
        Array.from(child.childNodes).every(
          (n) => n.nodeType !== Node.TEXT_NODE || !(n.textContent ?? "").trim(),
        );
      if (open) walk(child);
      else out.push(child);
    }
  };
  walk(root);
  return out;
}

export interface Layout {
  pages: PageBox[];
  /** 1-based page that holds `node` (an element inside the paginated root). */
  pageOf: (node: Node) => number;
}

/** Lay `root` out as A4 pages. `paper` is the A4-wide box that the measures
 *  are taken against (it may be visually scaled). Idempotent: undoes its own
 *  previous pass first. */
export function paginate(root: HTMLElement, paper: HTMLElement, page = A4): Layout {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-page-push]"))) {
    el.style.marginTop = el.dataset.pagePush ?? "";
    delete el.dataset.pagePush;
  }
  const blocks = collectBlocks(root);
  const box = paper.getBoundingClientRect();
  const scale = box.width > 0 ? box.width / page.width : 1;
  const y = (v: number) => (v - box.top) / scale;
  const extents: Extent[] = blocks.map((b) => {
    const r = b.getBoundingClientRect();
    return { top: y(r.top), bottom: y(r.bottom), keepWithNext: HEADING.test(b.tagName) };
  });
  const plan = planPages(extents, page);

  // Apply each push, then correct it against the live layout: margin
  // collapsing (with a sibling or a parent) can absorb part of a push.
  let shift = 0;
  for (const { index, delta } of plan.pushes) {
    const b = blocks[index];
    const target = extents[index].top + shift + delta;
    b.dataset.pagePush = b.style.marginTop;
    const base = parseFloat(getComputedStyle(b).marginTop) || 0;
    b.style.marginTop = `${base + delta}px`;
    const off = target - y(b.getBoundingClientRect().top);
    if (Math.abs(off) > EPS) b.style.marginTop = `${base + delta + off}px`;
    shift += delta;
  }

  const starts = plan.pushes.map((p) => blocks[p.index]);
  return {
    pages: plan.pages,
    pageOf: (node: Node) => {
      let n = 1;
      for (const s of starts) {
        if (s === node || s.contains(node) || s.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) n++;
        else break;
      }
      return n;
    },
  };
}
