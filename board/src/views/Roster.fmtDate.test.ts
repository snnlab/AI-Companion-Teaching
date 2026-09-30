import { describe, expect, it } from "vitest";
import { fmtDate } from "./Roster";

describe("fmtDate", () => {
  it("shows the same instant identically whatever offset it arrived with", () => {
    // submittedAt carries the student's offset; releasedAt is server UTC.
    expect(fmtDate("2026-09-30T13:51:00+09:00")).toBe(fmtDate("2026-09-30T04:51:00.000Z"));
  });
  it("formats as YYYY-MM-DD HH:MM", () => {
    expect(fmtDate("2026-09-30T04:51:00.000Z")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
  it("falls back to the raw prefix for an unparseable value", () => {
    expect(fmtDate("not-a-dateTxxxxxxxx")).toBe("not-a-date xxxxx");
  });
});
