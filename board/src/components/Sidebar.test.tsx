// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import Sidebar from "./Sidebar";
import type { FileNode } from "../lib/filesTree";
import type { OutlineEntry } from "../lib/outline";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const tree: FileNode[] = [
  { id: "master-plan", label: "Master plan", route: { tab: "tracker", annotationId: "", anchored: false } },
  {
    id: "component:01-x",
    label: "01-x",
    children: [
      {
        id: "01-x:plans",
        label: "Plans",
        children: [
          { id: "plans/execution/01-x/v1.md", label: "v1", route: { tab: "plans", component: "01-x", planPath: "plans/execution/01-x/v1.md", annotationId: "", anchored: false } },
        ],
      },
    ],
  },
];

function renderSidebar(over: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const onNavigate = vi.fn();
  const onSelect = vi.fn();
  const outline: OutlineEntry[] = [{ id: "g", label: "Goal", level: 1, onSelect }];
  const { container } = render(
    <Sidebar
      outline={outline}
      tree={tree}
      onNavigate={onNavigate}
      activeId="plans/execution/01-x/v1.md"
      activeLabel="v1 — 01-x"
      activeOutlineId={null}
      storageKey="aict-sidebar:test"
      {...over}
    />,
  );
  return { container, onNavigate, onSelect };
}

describe("Sidebar", () => {
  it("uses full width until the desktop breakpoint", () => {
    const { container } = renderSidebar();
    const aside = container.querySelector("aside")!;
    expect(aside.className).toContain("w-full");
    expect(aside.className).toContain("lg:w-56");
    expect(aside.className).toContain("lg:sticky");
  });

  it("shows Outline by default and fires onSelect", () => {
    const { onSelect } = renderSidebar();
    fireEvent.click(screen.getByText("Goal"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("switches to Files and navigates a leaf via its route", () => {
    const { onNavigate } = renderSidebar({ activeId: null, activeLabel: null });
    fireEvent.click(screen.getByRole("tab", { name: /files/i }));
    fireEvent.click(screen.getByText("Plans")); // expand depth-1 group
    fireEvent.click(screen.getByText("v1"));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ tab: "plans", planPath: "plans/execution/01-x/v1.md" }));
  });

  it("labels its tabs and file tree with the expected semantics", () => {
    renderSidebar();
    expect(screen.getByRole("tablist", { name: "Sidebar views" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: /outline/i }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: /files/i }));
    expect(screen.getByRole("tree", { name: "Project files" })).not.toBeNull();
    expect(screen.getByRole("treeitem", { name: "01-x" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("uses roving focus and arrow keys for sidebar tabs", () => {
    renderSidebar();
    const outline = screen.getByRole("tab", { name: /outline/i });
    const files = screen.getByRole("tab", { name: /files/i });
    expect(outline.tabIndex).toBe(0);
    expect(files.tabIndex).toBe(-1);

    outline.focus();
    fireEvent.keyDown(outline, { key: "ArrowRight" });

    expect(document.activeElement).toBe(files);
    expect(files.tabIndex).toBe(0);
    expect(outline.tabIndex).toBe(-1);
    expect(files.getAttribute("aria-selected")).toBe("true");
  });

  it("moves through and activates file-tree items from the keyboard", () => {
    const { onNavigate } = renderSidebar({ activeId: null, activeLabel: null });
    fireEvent.click(screen.getByRole("tab", { name: /files/i }));
    const masterPlan = screen.getByRole("treeitem", { name: "Master plan" });
    const initialTabStops = screen
      .getAllByRole("treeitem")
      .filter((item) => item.tabIndex === 0);
    expect(initialTabStops).toEqual([masterPlan]);
    masterPlan.focus();
    fireEvent.keyDown(masterPlan, { key: "ArrowDown" });
    const component = screen.getByRole("treeitem", { name: "01-x" });
    expect(document.activeElement).toBe(component);
    expect(component.tabIndex).toBe(0);
    expect(masterPlan.tabIndex).toBe(-1);

    const plans = screen.getByRole("treeitem", { name: "Plans" });
    fireEvent.keyDown(plans, { key: "ArrowRight" });
    const plan = screen.getByRole("treeitem", { name: "v1" });
    plan.focus();
    fireEvent.keyDown(plan, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ tab: "plans", planPath: "plans/execution/01-x/v1.md" }));
  });

  it("marks exactly the active leaf and auto-expands its ancestors", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("tab", { name: /files/i }));
    const active = screen.getByRole("treeitem", { name: /v1/ });
    expect(active.getAttribute("data-active")).toBe("true");
    expect(screen.getByRole("treeitem", { name: "01-x" }).getAttribute("data-active")).toBeNull();
    expect(screen.getByRole("treeitem", { name: "Plans" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("marks nothing when activeId is null", () => {
    renderSidebar({ activeId: null, activeLabel: null });
    fireEvent.click(screen.getByRole("tab", { name: /files/i }));
    const marked = screen.queryAllByRole("treeitem").filter((el) => el.getAttribute("data-active"));
    expect(marked).toHaveLength(0);
  });

  it("shows the active document label above the outline", () => {
    renderSidebar({ activeId: "x", activeLabel: "v2 — 03-hetero" });
    expect(screen.getByText("v2 — 03-hetero")).toBeTruthy();
  });

  it("marks only the active outline entry as current", () => {
    const outline: OutlineEntry[] = [
      { id: "goal", label: "Goal", level: 1, onSelect: vi.fn() },
      { id: "decisions", label: "Decisions", level: 1, onSelect: vi.fn() },
    ];
    renderSidebar({ outline, activeOutlineId: "decisions" });

    const active = screen.getByRole("button", { name: "Decisions" });
    const inactive = screen.getByRole("button", { name: "Goal" });
    expect(active.getAttribute("data-active")).toBe("true");
    expect(active.getAttribute("aria-current")).toBe("true");
    expect(inactive.getAttribute("data-active")).toBeNull();
    expect(inactive.getAttribute("aria-current")).toBeNull();
  });

  it("marks no outline entry when the active outline id is null", () => {
    renderSidebar({ activeOutlineId: null });

    expect(screen.getByRole("button", { name: "Goal" }).getAttribute("data-active")).toBeNull();
    expect(screen.getByRole("button", { name: "Goal" }).getAttribute("aria-current")).toBeNull();
  });

  it("collapses, persists, and starts collapsed when defaultCollapsed and nothing stored", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(localStorage.getItem("aict-sidebar:test")).toContain("collapsed");
    expect(screen.queryByText("Goal")).toBeNull();
    const expand = screen.getByRole("button", { name: /expand sidebar/i });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(expand);
    fireEvent.click(expand);
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /outline/i }));
    cleanup();
    localStorage.clear();
    renderSidebar({ defaultCollapsed: true });
    expect(screen.queryByText("Goal")).toBeNull(); // honored default
  });
});
