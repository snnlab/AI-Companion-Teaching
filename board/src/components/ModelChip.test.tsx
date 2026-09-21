// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ModelChip from "./ModelChip";

afterEach(cleanup);

describe("ModelChip", () => {
  it("renders the model and its effort", () => {
    render(<ModelChip usage={{ model: "opus", effort: "max" }} />);
    expect(screen.getByText("opus·max")).toBeTruthy();
  });

  it("uses a custom label", () => {
    render(<ModelChip usage={{ model: "opus", effort: null }} label="captured by" />);
    expect(screen.getByText("captured by opus")).toBeTruthy();
  });

  it("renders nothing for null usage", () => {
    const { container } = render(<ModelChip usage={null} />);
    expect(container.firstChild).toBeNull();
  });
});
