// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import Markdown from "./Markdown";

afterEach(cleanup);

describe("Markdown assets image resolution", () => {
  const assets = { "fig1.png": "data:image/png;base64,AAAA" };
  it("resolves a relative path by basename against assets", () => {
    const { container } = render(
      <Markdown source="![Fig one](../execution/01-x/results/r1/artifacts/fig1.png)" assets={assets} />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(img?.getAttribute("alt")).toBe("Fig one");
  });
  it("never emits an external URL: unresolved images become alt text", () => {
    const { container } = render(
      <Markdown source="![evil](https://evil.example/x.png)" assets={assets} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("evil");
  });
  it("escapes attribute-breaking alt text", () => {
    const { container } = render(
      <Markdown source={'![a"><script>x</script>](fig1.png)'} assets={assets} />,
    );
    expect(container.querySelector("script")).toBeNull();
  });
  it("without assets prop, behavior is unchanged (img passes through Marked)", () => {
    const { container } = render(<Markdown source="![a](x.png)" />);
    expect(container.querySelector("img")).not.toBeNull();
  });
  it("prefers an exact-href key (manuscript figures) over basename", () => {
    const { container } = render(
      <Markdown
        source="![Figure 1](<figures/my fig.png>)"
        assets={{ "figures/my fig.png": "data:image/png;base64,EXACT", "my fig.png": "data:x" }}
      />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,EXACT");
  });
});
