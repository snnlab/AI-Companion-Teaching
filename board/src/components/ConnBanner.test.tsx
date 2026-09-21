// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ConnBanner from "./ConnBanner";

afterEach(cleanup);

describe("ConnBanner", () => {
  it("renders nothing while online", () => {
    const { container } = render(
      <ConnBanner phase={{ kind: "online", lastBootId: null }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("applying promises a self-refresh", () => {
    render(
      <ConnBanner
        phase={{ kind: "applying", actionId: "a", bootId: "b", projectId: "p", since: 0 }}
      />,
    );
    expect(screen.getByText(/Sent to Claude/)).toBeTruthy();
    expect(screen.getByText(/aict:board to reopen/)).toBeTruthy();
  });

  it("stalled keeps waiting and names the recovery command", () => {
    render(
      <ConnBanner
        phase={{ kind: "stalled", actionId: "a", bootId: "b", projectId: "p", since: 0 }}
      />,
    );
    expect(screen.getByText(/Sent to Claude/)).toBeTruthy();
    expect(screen.getByText(/aict:board/)).toBeTruthy();
  });

  it("sleeping names the wake command and reassures about drafts", () => {
    render(<ConnBanner phase={{ kind: "sleeping", lastBootId: "b" }} />);
    expect(screen.getByText(/Board sleeping/)).toBeTruthy();
    expect(screen.getByText(/drafts are safe/)).toBeTruthy();
  });

  it("shows sign-session recovery copy when that one-shot server has ended", () => {
    render(<ConnBanner phase={{ kind: "sleeping", lastBootId: null }} signSessionEnded />);
    expect(screen.getByText(/your draft is saved/i)).toBeTruthy();
    expect(screen.getByText(/aict:sign/)).toBeTruthy();
  });
});
