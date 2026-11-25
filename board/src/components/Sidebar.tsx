import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { NavTarget } from "../lib/navTarget";
import { subtreeHasId, type FileNode } from "../lib/filesTree";
import type { OutlineEntry } from "../lib/outline";

type SubTab = "outline" | "files";
interface Persisted { sub: SubTab; collapsed: boolean }

function load(key: string, defaultCollapsed: boolean): Persisted {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { sub: "outline", collapsed: false, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { sub: "outline", collapsed: defaultCollapsed };
}

export default function Sidebar({
  outline,
  tree,
  onNavigate,
  activeId,
  activeLabel,
  activeOutlineId,
  storageKey,
  defaultCollapsed = false,
  topOffsetPx = 16,
}: {
  outline: OutlineEntry[];
  tree: FileNode[];
  onNavigate: (t: NavTarget) => void;
  activeId: string | null;
  activeLabel: string | null;
  activeOutlineId: string | null;
  storageKey: string;
  defaultCollapsed?: boolean;
  topOffsetPx?: number; // App's measured sticky-header height (headerOffset)
}) {
  const [state, setState] = useState<Persisted>(() => load(storageKey, defaultCollapsed));
  const [treeTabStop, setTreeTabStop] = useState(tree[0]?.id ?? "");
  useEffect(() => {
    if (activeId && tree.some((n) => subtreeHasId(n, activeId))) setTreeTabStop(activeId);
  }, [activeId, tree]);
  const expandRef = useRef<HTMLButtonElement>(null);
  const subTabRefs = useRef<Record<SubTab, HTMLButtonElement | null>>({
    outline: null,
    files: null,
  });
  const focusAfterToggle = useRef<"expand" | "tab" | null>(null);
  const persist = (next: Persisted) => {
    setState(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const selectSubTab = (sub: SubTab, focus = false) => {
    persist({ ...state, sub });
    if (focus) subTabRefs.current[sub]?.focus();
  };

  const handleSubTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    sub: SubTab,
  ) => {
    let next: SubTab | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      next = sub === "outline" ? "files" : "outline";
    } else if (event.key === "Home") {
      next = "outline";
    } else if (event.key === "End") {
      next = "files";
    }
    if (next) {
      event.preventDefault();
      selectSubTab(next, true);
    }
  };

  useEffect(() => {
    if (state.collapsed && focusAfterToggle.current === "expand") {
      expandRef.current?.focus();
      focusAfterToggle.current = null;
    } else if (!state.collapsed && focusAfterToggle.current === "tab") {
      subTabRefs.current[state.sub]?.focus();
      focusAfterToggle.current = null;
    }
  }, [state.collapsed, state.sub]);

  if (state.collapsed) {
    return (
      <aside
        className="sticky w-8 shrink-0 self-start border-r border-stone-200 dark:border-stone-800"
        style={{ top: topOffsetPx }}
      >
        <button
          ref={expandRef}
          aria-label="Expand sidebar"
          aria-expanded={false}
          className="w-full py-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          onClick={() => {
            focusAfterToggle.current = "tab";
            persist({ ...state, collapsed: false });
          }}
        >
          »
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="w-full self-start overflow-y-auto border-b border-stone-200 pb-3 dark:border-stone-800 lg:sticky lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-3"
      style={{ top: topOffsetPx, maxHeight: `calc(100vh - ${topOffsetPx + 16}px)` }}
    >
      <div role="tablist" aria-label="Sidebar views" className="mb-3 flex items-center gap-1">
        {(["outline", "files"] as SubTab[]).map((s) => (
          <button
            key={s}
            ref={(el) => { subTabRefs.current[s] = el; }}
            id={`sidebar-${s}-tab`}
            role="tab"
            aria-selected={state.sub === s}
            aria-controls={`sidebar-${s}-panel`}
            tabIndex={state.sub === s ? 0 : -1}
            className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
              state.sub === s
                ? "bg-stone-900 text-white dark:bg-stone-200 dark:text-stone-900"
                : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
            }`}
            onClick={() => selectSubTab(s)}
            onKeyDown={(event) => handleSubTabKeyDown(event, s)}
          >
            {s}
          </button>
        ))}
        <button
          aria-label="Collapse sidebar"
          aria-expanded={true}
          className="ml-auto rounded px-1.5 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          onClick={() => {
            focusAfterToggle.current = "expand";
            persist({ ...state, collapsed: true });
          }}
        >
          «
        </button>
      </div>

      {state.sub === "outline" ? (
        <div
          id="sidebar-outline-panel"
          role="tabpanel"
          aria-labelledby="sidebar-outline-tab"
        >
          {activeLabel && (
            <div className="mb-1 px-2 text-[11px] font-semibold text-stone-500 dark:text-stone-400">
              {activeLabel}
            </div>
          )}
          <ul className="space-y-0.5">
            {outline.length === 0 && (
              <li className="px-2 py-1 text-xs text-stone-400">No outline for this view.</li>
            )}
            {outline.map((e) => {
              const isActive = e.id === activeOutlineId;
              return (
                <li key={e.id}>
                  <button
                    data-active={isActive ? "true" : undefined}
                    aria-current={isActive ? "true" : undefined}
                    className={`w-full rounded px-2 py-1 text-left text-xs hover:bg-stone-100 dark:hover:bg-stone-800 ${
                      isActive
                        ? "bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100"
                        : "text-stone-600 dark:text-stone-400"
                    }`}
                    style={{ paddingLeft: `${0.5 + (e.level - 1) * 0.75}rem` }}
                    onClick={e.onSelect}
                  >
                    {e.page === undefined ? (
                      e.label
                    ) : (
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1">{e.label}</span>
                        <span className="shrink-0 tabular-nums text-stone-400 dark:text-stone-500" aria-label={`page ${e.page}`}>
                          {e.page}
                        </span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div
          id="sidebar-files-panel"
          role="tabpanel"
          aria-labelledby="sidebar-files-tab"
        >
          <ul role="tree" aria-label="Project files" className="space-y-0.5">
            {tree.map((n) => (
              <TreeNode
                key={n.id}
                node={n}
                depth={0}
                onNavigate={onNavigate}
                activeId={activeId}
                treeTabStop={treeTabStop}
                onTreeFocus={setTreeTabStop}
              />
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

function TreeNode({
  node,
  depth,
  onNavigate,
  activeId,
  treeTabStop,
  onTreeFocus,
}: {
  node: FileNode;
  depth: number;
  onNavigate: (t: NavTarget) => void;
  activeId: string | null;
  treeTabStop: string;
  onTreeFocus: (id: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = !!node.children?.length;
  const isActive = activeId !== null && node.id === activeId;
  const containsActive = activeId !== null && subtreeHasId(node, activeId);
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);
  const activate = () =>
    hasChildren ? setOpen((o) => !o) : node.route && onNavigate(node.route);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const item = event.currentTarget;
    const tree = item.closest('[role="tree"]');
    const items = tree
      ? Array.from(tree.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'))
      : [];
    const index = items.indexOf(item);
    const focusItem = (next: HTMLButtonElement) => {
      onTreeFocus(next.dataset.treeId ?? "");
      next.focus();
    };
    if (event.key === "ArrowDown" && index < items.length - 1) {
      event.preventDefault();
      focusItem(items[index + 1]);
    } else if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      focusItem(items[index - 1]);
    } else if (event.key === "Home" && items.length > 0) {
      event.preventDefault();
      focusItem(items[0]);
    } else if (event.key === "End" && items.length > 0) {
      event.preventDefault();
      focusItem(items[items.length - 1]);
    } else if (event.key === "ArrowRight" && hasChildren) {
      event.preventDefault();
      if (!open) setOpen(true);
      else {
        const child = item.parentElement?.querySelector<HTMLButtonElement>(
          '[role="group"] [role="treeitem"]',
        );
        if (child) focusItem(child);
      }
    } else if (event.key === "ArrowLeft") {
      if (hasChildren && open) {
        event.preventDefault();
        setOpen(false);
      } else {
        const parentGroup = item.parentElement?.parentElement;
        const parentItem = parentGroup?.parentElement?.querySelector<HTMLButtonElement>(
          ':scope > [role="treeitem"]',
        );
        if (parentItem) {
          event.preventDefault();
          focusItem(parentItem);
        }
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  };

  return (
    <li role="none">
      <button
        role="treeitem"
        data-tree-id={node.id}
        aria-expanded={hasChildren ? open : undefined}
        data-active={isActive ? "true" : undefined}
        tabIndex={treeTabStop === node.id ? 0 : -1}
        className={`w-full rounded px-2 py-1 text-left text-xs hover:bg-stone-100 dark:hover:bg-stone-800 ${
          isActive
            ? "bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100"
            : "text-stone-600 dark:text-stone-400"
        }`}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
        onClick={activate}
        onFocus={() => onTreeFocus(node.id)}
        onKeyDown={handleKeyDown}
      >
        {hasChildren && <span aria-hidden className="mr-1 text-stone-400">{open ? "▾" : "▸"}</span>}
        <span>{node.label}</span>
        {node.badge && (
          <span className="ml-1 rounded bg-stone-200 px-1 py-0.5 text-[10px] text-stone-600 dark:bg-stone-700 dark:text-stone-400">
            {node.badge}
          </span>
        )}
      </button>
      {hasChildren && open && (
        <ul role="group" className="space-y-0.5">
          {node.children!.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              depth={depth + 1}
              onNavigate={onNavigate}
              activeId={activeId}
              treeTabStop={treeTabStop}
              onTreeFocus={onTreeFocus}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
