// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import Roster from "./Roster";
import type { RosterData } from "../lib/rosterTypes";

afterEach(cleanup);

function data(): RosterData {
  return {
    schemaVersion: 1,
    course: { id: "soc-501", name: "Quant Methods" },
    generatedAt: "2026-08-20T09:00",
    students: [
      {
        studentId: "s-amara",
        displayName: "Amara",
        submissionCount: 2,
        lastSubmission: {
          submittedAt: "2026-08-19T14:30",
          idempotencyKey: "k1",
          integrityStatus: "passed",
        },
        isNewSinceLastView: true,
      },
      {
        studentId: "s-brody",
        displayName: "Brody",
        submissionCount: 1,
        lastSubmission: {
          submittedAt: "2026-08-18T09:00",
          idempotencyKey: "k2",
          integrityStatus: "failed",
        },
      },
      {
        studentId: "s-cora",
        displayName: "Cora",
        submissionCount: 0,
        lastSubmission: null,
      },
    ],
  };
}

describe("Roster table", () => {
  it("lists every registered student", () => {
    render(<Roster data={data()} />);
    expect(screen.getByText("Amara")).toBeTruthy();
    expect(screen.getByText("Brody")).toBeTruthy();
    expect(screen.getByText("Cora")).toBeTruthy();
  });

  it("shows never-submitted rows distinctly and does not make them clickable", () => {
    render(<Roster data={data()} />);
    expect(screen.getByText("never submitted")).toBeTruthy();
    const row = screen.getByText("Cora").closest("tr")!;
    expect(row.getAttribute("title")).toBe("No submissions yet");
  });

  it("shows a \"new\" badge only for a row flagged isNewSinceLastView", () => {
    render(<Roster data={data()} />);
    const amaraRow = screen.getByText("Amara").closest("tr")!;
    const brodyRow = screen.getByText("Brody").closest("tr")!;
    expect(within(amaraRow).getByText("new")).toBeTruthy();
    expect(within(brodyRow).queryByText("new")).toBeNull();
  });

  it("keeps the mechanical verification signals off this screen", () => {
    render(<Roster data={data()} />);
    // No F·A·I score chip, no integrity pass/fail vocabulary, no trust-tier legend.
    expect(screen.queryByText("How to read these signals")).toBeNull();
    expect(screen.queryByText(/F·A·I/)).toBeNull();
    expect(screen.queryByText("passed")).toBeNull();
    expect(screen.queryByText("failed")).toBeNull();
  });

  it("sorts by student name and reverses on a second click", () => {
    render(<Roster data={data()} />);
    const header = screen.getByRole("button", { name: /Student/ });
    const namesInOrder = () =>
      Array.from(document.querySelectorAll("tbody tr td:first-child"))
        .map((td) => td.textContent?.split("(")[0].trim());
    expect(namesInOrder()).toEqual(["Amara", "Brody", "Cora"]);
    fireEvent.click(header);
    expect(namesInOrder()).toEqual(["Cora", "Brody", "Amara"]);
  });

  it("shows an empty-roster message when no students are registered", () => {
    render(<Roster data={{ ...data(), students: [] }} />);
    expect(screen.getByText(/No students registered yet/)).toBeTruthy();
  });
});
