import { describe, it, expect, vi, beforeEach } from "vitest";

const { put, get } = vi.hoisted(() => ({
  put: vi.fn(async (_pathname: string, _body: string, _options?: Record<string, unknown>) => ({})),
  get: vi.fn(),
}));
vi.mock("@vercel/blob", () => ({ put, get }));

import { compareStudents, SIMILARITY_THRESHOLD, writeSimilarityCache, readSimilarityCache } from "./similarity";

beforeEach(() => {
  put.mockClear();
  get.mockReset();
});

const SHARED_PARAGRAPH =
  "We decided to drop missing income cases listwise because the missingness pattern looked close to " +
  "completely at random after checking against the observed covariates in the pilot wave data set today";

describe("compareStudents", () => {
  it("flags two students whose decision logs share a long verbatim passage", () => {
    const flags = compareStudents([
      { studentId: "alice", decisionLogText: `## 2026-08-01 10:00\n\n${SHARED_PARAGRAPH}\n` },
      { studentId: "bob", decisionLogText: `## 2026-08-02 11:00\n\n${SHARED_PARAGRAPH}\n` },
    ]);
    expect(flags.length).toBe(1);
    expect(flags[0].jaccard).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
    expect(flags[0].artifact).toBe("decision-log");
    expect([flags[0].studentA, flags[0].studentB].sort()).toEqual(["alice", "bob"]);
    expect(flags[0].sampleSharedPhrase.split(" ").length).toBe(8);
  });

  it("does not flag two unrelated decision logs", () => {
    const flags = compareStudents([
      { studentId: "alice", decisionLogText: "We ran a CLPM on the three annual waves after listwise deletion." },
      { studentId: "carol", decisionLogText: "I chose RI-CLPM instead because unit-level trait stability mattered here." },
    ]);
    expect(flags.length).toBe(0);
  });

  it("ignores decision-log heading lines (dates) when computing overlap", () => {
    const flags = compareStudents([
      { studentId: "alice", decisionLogText: "## 2026-08-01 10:00\n\nUnrelated text about missingness handling choices for alice's own paper only." },
      { studentId: "dave", decisionLogText: "## 2026-08-01 10:00\n\nCompletely different content about dave's model specification choices entirely." },
    ]);
    // Same heading date, different body — must not be flagged purely because
    // the metadata line matches.
    expect(flags.length).toBe(0);
  });

  it("produces no flags, and no crash, for a single student or empty input", () => {
    expect(compareStudents([])).toEqual([]);
    expect(compareStudents([{ studentId: "solo", decisionLogText: "text" }])).toEqual([]);
  });

  it("handles empty decision-log text without throwing", () => {
    const flags = compareStudents([
      { studentId: "alice", decisionLogText: "" },
      { studentId: "bob", decisionLogText: "" },
    ]);
    expect(flags).toEqual([]);
  });
});

describe("similarity cache", () => {
  it("writes and reads back the cached result", async () => {
    const result = { checkedAt: "2026-08-20T00:00:00.000Z", flags: [] };
    await writeSimilarityCache("tok", result);
    expect(put).toHaveBeenCalledWith(
      "similarity/latest.json",
      JSON.stringify(result),
      expect.objectContaining({ access: "private", allowOverwrite: true, token: "tok" }),
    );

    get.mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(result))); c.close(); } }),
    });
    const read = await readSimilarityCache("tok");
    expect(read).toEqual(result);
  });

  it("returns null when nothing is cached yet", async () => {
    get.mockResolvedValue(null);
    expect(await readSimilarityCache("tok")).toBeNull();
  });
});
