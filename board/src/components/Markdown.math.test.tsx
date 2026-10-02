// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import Markdown from "./Markdown";

afterEach(cleanup);

function md(source: string, math = true) {
  return render(<Markdown source={source} math={math} />).container;
}

describe("Markdown math (manuscript)", () => {
  it("renders inline $…$ as MathML without markdown mangling _ and *", () => {
    const c = md("The effect $\\beta_1 * x_i$ is small.");
    const span = c.querySelector(".math-inline");
    expect(span?.getAttribute("data-tex")).toBe("\\beta_1 * x_i");
    expect(span?.querySelector("math")).not.toBeNull();
    expect(c.querySelector("em")).toBeNull();
  });

  it("renders $$…$$ on its own lines as display math", () => {
    const c = md("Model:\n\n$$\ny_{it} = \\alpha + \\beta x_{it}\n+ \\varepsilon_{it}\n$$\n\nwhere y is…");
    const d = c.querySelector(".math-display");
    expect(d).not.toBeNull();
    expect(d?.querySelector('math[display="block"]')).not.toBeNull();
    expect(c.textContent).toContain("where y is");
  });

  it("supports \\( \\) and \\[ \\] delimiters", () => {
    const c = md("Inline \\(a^2\\) and\n\n\\[\\frac{a}{b}\\]");
    expect(c.querySelector(".math-inline")?.getAttribute("data-tex")).toBe("a^2");
    expect(c.querySelector(".math-display")?.getAttribute("data-tex")).toBe("\\frac{a}{b}");
  });

  it("keeps aligned rows intact (no soft-unwrap inside a display block)", () => {
    const c = md("$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$");
    expect(c.querySelector(".katex-error")).toBeNull();
    expect(c.querySelectorAll("mtr").length).toBe(2);
  });

  it("leaves prose dollar amounts alone", () => {
    const c = md("It costs $5 to $10, and \\$x\\$ is literal.");
    expect(c.querySelector(".math")).toBeNull();
    expect(c.textContent).toContain("$5 to $10");
  });

  it("never touches code spans or blocks", () => {
    const c = md("`$x$` and\n\n```\n$$y$$\n```");
    expect(c.querySelector(".math")).toBeNull();
  });

  it("strips the hidden TeX annotation so text anchoring sees only visible math", () => {
    const c = md("Let $x_1$ be");
    expect(c.querySelector("annotation")).toBeNull();
    expect(c.textContent).not.toContain("x_1");
  });

  it("renders a parse error as source text instead of throwing", () => {
    const c = md("Bad $\\frac{a$ here");
    expect(c.querySelector(".katex-error")).not.toBeNull();
    expect(c.textContent).toContain("here");
  });

  it("blocks trust-gated commands (\\href) — output stays inert", () => {
    const c = md("$\\href{javascript:alert(1)}{x}$");
    expect(c.querySelector("a")).toBeNull();
    expect(c.querySelector("[href]")).toBeNull();
  });

  it("is off by default (plans/reports)", () => {
    const c = md("Budget $x_1$ and $y$", false);
    expect(c.querySelector(".math")).toBeNull();
  });
});
