import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { A4, paginate, type Layout, type PageBox } from "../lib/pagination";
import { prefersReducedMotion } from "../lib/scrollSpy";

const ONE_PAGE: PageBox[] = [{ top: 0, height: A4.height }];

function samePages(a: PageBox[], b: PageBox[]): boolean {
  return a.length === b.length && a.every((p, i) => p.top === b[i].top && p.height === b[i].height);
}

/** The manuscript drawn as A4 sheets (lib/pagination.ts). `children` is the
 *  manuscript's own block (its `.prose-md` root is what gets paginated); it
 *  stays one continuous DOM, so comment anchoring and the outline are
 *  unaffected. A narrow window scales the whole paper down, like a PDF
 *  viewer, so the page breaks are the same on every screen. */
export default function A4Pages({
  children,
  contentKey,
  onLayout,
}: {
  children: ReactNode;
  /** Changes when the manuscript content changes. */
  contentKey: string;
  onLayout?: (layout: Layout | null) => void;
}) {
  const deskRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PageBox[]>(ONE_PAGE);
  const [scale, setScale] = useState(1);
  const [current, setCurrent] = useState(1);
  const onLayoutRef = useRef(onLayout);
  onLayoutRef.current = onLayout;

  // Fit the paper to the available width.
  useLayoutEffect(() => {
    const desk = deskRef.current;
    if (!desk) return;
    const fit = () => {
      const cs = getComputedStyle(desk);
      const w = desk.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      setScale(w > 0 ? Math.min(1, w / A4.width) : 1);
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(desk);
    return () => ro.disconnect();
  }, []);

  // Paginate now, and again when the content's size changes (figures and
  // fonts load late; painting comment highlights can reflow a line).
  useLayoutEffect(() => {
    const paper = paperRef.current;
    const root = paper?.querySelector<HTMLElement>(".prose-md");
    if (!paper || !root) return;
    let raf = 0;
    let alive = true;
    let reported: PageBox[] | null = null;
    const run = () => {
      raf = 0;
      if (!alive) return;
      const layout = paginate(root, paper);
      setPages((prev) => (samePages(prev, layout.pages) ? prev : layout.pages));
      // A re-run over unchanged content lands on the same pages: report
      // only real changes, so the outline is not rebuilt for nothing.
      if (!reported || !samePages(reported, layout.pages)) {
        reported = layout.pages;
        onLayoutRef.current?.(layout);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    run();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(schedule);
      ro.observe(root);
    }
    root.addEventListener("load", schedule, true);
    document.fonts?.ready.then(schedule).catch(() => {});
    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      root.removeEventListener("load", schedule, true);
      onLayoutRef.current?.(null);
    };
  }, [contentKey]);

  // Which page is in view: the last sheet whose top is above a line a third
  // of the way down the window.
  useEffect(() => {
    const update = () => {
      const paper = paperRef.current;
      if (!paper) return;
      const line = window.innerHeight * 0.35;
      let n = 1;
      paper.querySelectorAll<HTMLElement>("[data-sheet]").forEach((s, i) => {
        if (s.getBoundingClientRect().top < line) n = i + 1;
      });
      setCurrent(n);
    };
    update();
    document.addEventListener("scroll", update, { capture: true, passive: true });
    window.addEventListener("resize", update);
    return () => {
      document.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("resize", update);
    };
  }, [pages]);

  const goTo = (n: number) => {
    const target = Math.max(1, Math.min(pages.length, n));
    const sheet = paperRef.current?.querySelectorAll<HTMLElement>("[data-sheet]")[target - 1];
    sheet?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    setCurrent(target);
  };

  const last = pages[pages.length - 1];
  const paperHeight = last.top + last.height;

  return (
    <>
      <div ref={deskRef} className="a4-desk" data-testid="a4-desk">
        <div
          className="a4-stage"
          style={{ width: A4.width * scale, height: paperHeight * scale }}
        >
          <div
            ref={paperRef}
            className="a4-paper"
            style={{
              width: A4.width,
              height: paperHeight,
              transform: scale < 1 ? `scale(${scale})` : undefined,
              ["--a4-margin" as string]: `${A4.margin}px`,
            }}
          >
            <div className="a4-sheets" aria-hidden="true">
              {pages.map((p, i) => (
                <div key={i} className="a4-sheet" data-sheet style={{ top: p.top, height: p.height }}>
                  <span className="a4-folio" style={{ bottom: A4.margin / 2 - 8 }}>
                    {i + 1}
                  </span>
                </div>
              ))}
            </div>
            {children}
          </div>
        </div>
      </div>
      {pages.length > 1 && <Pager current={current} total={pages.length} goTo={goTo} />}
    </>
  );
}

function Pager({ current, total, goTo }: { current: number; total: number; goTo: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = parseInt(draft ?? "", 10);
    if (!Number.isNaN(n)) goTo(n);
    setDraft(null);
  };
  const btn =
    "grid h-7 w-7 place-items-center rounded-full text-base leading-none hover:bg-stone-100 disabled:opacity-35 disabled:hover:bg-transparent dark:hover:bg-stone-800";
  return (
    <nav
      aria-label="Manuscript pages"
      data-testid="a4-pager"
      className="fixed bottom-4 right-4 z-20 flex items-center gap-1 rounded-full border border-stone-300 bg-white/95 px-1 py-1 text-xs text-stone-700 shadow-lg backdrop-blur dark:border-stone-600 dark:bg-stone-900/95 dark:text-stone-200"
    >
      <button type="button" className={btn} onClick={() => goTo(current - 1)} disabled={current <= 1} aria-label="Previous page">
        ‹
      </button>
      <form onSubmit={submit} className="flex items-center gap-1 tabular-nums">
        <label htmlFor="a4-page-input" className="sr-only">
          Page
        </label>
        <span aria-hidden="true">Page</span>
        <input
          id="a4-page-input"
          inputMode="numeric"
          className="w-8 rounded border border-stone-300 bg-transparent px-1 py-0.5 text-center dark:border-stone-600"
          value={draft ?? String(current)}
          onFocus={(e) => {
            setDraft(String(current));
            e.currentTarget.select();
          }}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
          onBlur={() => setDraft(null)}
        />
        <span>of {total}</span>
      </form>
      <button type="button" className={btn} onClick={() => goTo(current + 1)} disabled={current >= total} aria-label="Next page">
        ›
      </button>
    </nav>
  );
}
