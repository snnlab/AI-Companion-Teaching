import { prefersReducedMotion } from "./scrollSpy";

/** A single entry in the sidebar Outline; `onSelect` performs the in-view jump. */
export interface OutlineEntry {
  id: string;
  label: string;
  level: number; // 1..3
  onSelect: () => void;
  /** Page the heading is on, for a paginated view (the A4 manuscript). */
  page?: number;
}

/** Build an outline from the rendered headings inside `root` (one entry each,
 *  index-keyed so duplicate heading text stays addressable). onSelect scrolls
 *  the captured element — the Markdown renderer adds no ids, so we hold nodes.
 *  `pageOf`, when given, numbers each entry with its page. */
export function outlineFromContainer(
  root: HTMLElement | null,
  pageOf?: (node: Node) => number,
): OutlineEntry[] {
  if (!root) return [];
  const heads = Array.from(root.querySelectorAll("h1, h2, h3")) as HTMLElement[];
  return heads.map((h, i) => ({
    id: `h-${i}`,
    label: (h.textContent ?? "").trim(),
    level: Number(h.tagName[1]),
    onSelect: () => h.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    }),
    ...(pageOf ? { page: pageOf(h) } : {}),
  }));
}
