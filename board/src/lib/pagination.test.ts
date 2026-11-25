import { describe, expect, it } from "vitest";
import { A4, planPages, type Extent } from "./pagination";

// Blocks of `h` px with `gap` px between them, starting at the top margin.
function stack(heights: number[], gap = 12, start: number = A4.margin): Extent[] {
  const out: Extent[] = [];
  let y = start;
  for (const h of heights) {
    out.push({ top: y, bottom: y + h });
    y += h + gap;
  }
  return out;
}

const BODY = A4.height - 2 * A4.margin; // 931

describe("planPages", () => {
  it("keeps everything on one A4 page when it fits", () => {
    const plan = planPages(stack([200, 200, 200]));
    expect(plan.pages).toEqual([{ top: 0, height: A4.height }]);
    expect(plan.pushes).toEqual([]);
    expect(plan.pageOfBlock).toEqual([1, 1, 1]);
  });

  it("moves a block that crosses the bottom margin to the next page's top margin", () => {
    const ex = stack([400, 400, 400]);
    const plan = planPages(ex);
    expect(plan.pageOfBlock).toEqual([1, 1, 2]);
    expect(plan.pages).toHaveLength(2);
    const second = plan.pages[1];
    expect(second.top).toBe(A4.height + A4.gap);
    // the pushed block now starts exactly at page 2's top margin
    expect(ex[2].top + plan.pushes[0].delta).toBe(second.top + A4.margin);
  });

  it("carries earlier pushes into later pages", () => {
    const plan = planPages(stack(Array(10).fill(300)));
    // three 300px blocks (+gaps) fit in a 931px body
    expect(plan.pageOfBlock).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4]);
    expect(plan.pages.map((p) => p.top)).toEqual([0, 1, 2, 3].map((i) => i * (A4.height + A4.gap)));
  });

  it("lets a block taller than a page overflow its page instead of leaving a blank one", () => {
    const ex = stack([BODY + 300, 100]);
    const plan = planPages(ex);
    expect(plan.pageOfBlock).toEqual([1, 2]);
    expect(plan.pages[0].height).toBe(ex[0].bottom + A4.margin);
  });

  it("never pushes the first block of a page", () => {
    const plan = planPages(stack([BODY + 300]));
    expect(plan.pushes).toEqual([]);
    expect(plan.pages).toHaveLength(1);
  });

  it("keeps a heading with the start of the block after it", () => {
    // heading lands just above the bottom margin; the paragraph after it does not fit
    const ex = stack([860, 40, 300]);
    ex[1].keepWithNext = true;
    const plan = planPages(ex);
    expect(plan.pageOfBlock).toEqual([1, 2, 2]);
  });
});
