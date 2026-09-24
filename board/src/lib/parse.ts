// Contract parsers for the aict artifact formats.
// The formats are defined by skills/managing-aict/templates/*.md;
// parse.test.ts uses those templates (and real generated artifacts) as fixtures,
// so a template change that breaks parsing fails the test suite.

import type {
  ParsedExecutionPlan,
  ParsedHistoryEntry,
  ParsedLogEntry,
  ParsedMasterPlan,
  ResearchQuestion,
  Scorecard,
  TrackerRow,
  TrackerStatus,
} from "./types";
import { SCORECARD_CHANNEL_IDS } from "./types";
import { parseTrailer } from "./trailer";

const STATUSES: TrackerStatus[] = [
  "not started",
  "planned",
  "in progress",
  "done",
  "done (verified)",
  "done (validated)",
  "done (unvalidated)",
  "done (retrofit)",
  "dropped",
];

export function isDoneStatus(status: TrackerStatus): boolean {
  return status === "done" || status.startsWith("done (");
}

function sectionBody(md: string, heading: string): string | null {
  // Returns the text between `## <heading>` and the next `## ` (or EOF).
  const re = new RegExp(`^## ${escapeRe(heading)}[ \\t]*$`, "m");
  const m = re.exec(md);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = md.slice(start);
  const next = rest.search(/^## /m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTableRows(block: string): string[][] {
  // GFM table rows -> array of cell arrays, skipping header + divider rows.
  const lines = block.split("\n").filter((l) => l.trim().startsWith("|"));
  const rows: string[][] = [];
  for (const line of lines) {
    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // divider
    rows.push(cells);
  }
  return rows.slice(1); // drop header row
}

/** Splits the Research questions subsection out of the Project context body. */
function extractResearchQuestions(contextBody: string): {
  contextMd: string;
  researchQuestions: ResearchQuestion[];
} {
  const m = /^### Research questions[ \t]*$/m.exec(contextBody);
  if (!m) return { contextMd: contextBody, researchQuestions: [] };
  const start = m.index;
  const afterHeading = start + m[0].length;
  const rest = contextBody.slice(afterHeading);
  const next = rest.search(/^### /m);
  const block = next === -1 ? rest : rest.slice(0, next);
  const end = afterHeading + (next === -1 ? rest.length : next);

  const researchQuestions: ResearchQuestion[] = [];
  const lineRe = /^\s*(?:\d+[.)]\s*)?RQ(\d+)\s*[:.]?\s*(.+)$/gm;
  for (const lm of block.matchAll(lineRe)) {
    researchQuestions.push({ num: parseInt(lm[1], 10), text: lm[2].trim() });
  }
  const contextMd = (contextBody.slice(0, start) + contextBody.slice(end)).trim();
  return { contextMd, researchQuestions };
}

export function parseMasterPlan(raw: string): ParsedMasterPlan {
  const fail: ParsedMasterPlan = {
    ok: false,
    title: "Paper Plan",
    lastUpdated: null,
    renewed: null,
    contextMd: "",
    researchQuestions: [],
    components: [],
    foundationsMd: null,
    sequencingMd: null,
    raw,
  };
  try {
    const title = /^# (.+)$/m.exec(raw)?.[1]?.trim() ?? "Paper Plan";
    const lastUpdated =
      /^Last updated:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? null;
    // v0.10: a renewal stamp. The template's placeholder has no real date, so
    // it (and every pre-v0.10 plan) parses to null.
    const renewedM = /^Renewed:\s*(\d{4}-\d{2}-\d{2})\s*(?:[—–-]\s*(.*))?$/m.exec(raw);
    const renewed = renewedM
      ? { date: renewedM[1], reason: (renewedM[2] ?? "").trim() }
      : null;
    const contextBody = sectionBody(raw, "Project context") ?? "";
    const { contextMd, researchQuestions } =
      extractResearchQuestions(contextBody);
    const componentsBlock = sectionBody(raw, "Components");
    if (componentsBlock === null) return fail;
    const components: TrackerRow[] = parseTableRows(componentsBlock).map(
      (cells) => {
        const [
          num = "",
          component = "",
          statusRaw = "",
          planLink = "",
          notes = "",
          serves = "",
        ] = cells;
        const statusClean = statusRaw.replace(/`/g, "").trim().toLowerCase();
        const status: TrackerStatus = (STATUSES as string[]).includes(
          statusClean,
        )
          ? (statusClean as TrackerStatus)
          : "unknown";
        return { num, component, status, planLink, notes, serves };
      },
    );
    const sequencingMd = sectionBody(raw, "Sequencing notes");
    const foundationsMd = sectionBody(raw, "Foundations");
    return {
      ok: true,
      title,
      lastUpdated,
      renewed,
      contextMd,
      researchQuestions,
      components,
      foundationsMd,
      sequencingMd,
      raw,
    };
  } catch {
    return fail;
  }
}

/** Execution slug from a tracker Plan-link cell, e.g. "[v1](execution/01-x/v1.md)". */
export function slugFromLink(link: string): string | null {
  const m = /execution\/([^/)]+)\//.exec(link);
  return m ? m[1] : null;
}

/** Slugs of execution groups that belong to an ARCHIVED master plan: not
 * referenced by the current master plan's content but referenced by some
 * archive's content. Pre-renewal work — browsable, never nagged about. */
export function preRenewalSlugs(data: {
  files: {
    masterPlan: { content: string };
    archives?: { content: string }[];
    executionPlans: { component: string }[];
  };
}): Set<string> {
  const archives = data.files.archives ?? [];
  const out = new Set<string>();
  if (archives.length === 0) return out;
  const master = data.files.masterPlan.content;
  for (const g of data.files.executionPlans) {
    const marker = `execution/${g.component}/`;
    if (
      !master.includes(marker) &&
      archives.some((a) => a.content.includes(marker))
    ) {
      out.add(g.component);
    }
  }
  return out;
}

/**
 * Normalizes a Serves value. `RQ` tokens are extracted case-insensitively and
 * canonicalized; an em/en dash or hyphen alone marks deliberate infrastructure.
 */
export function parseServes(s: string | null | undefined): {
  tokens: string[];
  isInfra: boolean;
  isEmpty: boolean;
} {
  const t = (s ?? "").replace(/`/g, "").trim();
  if (!t) return { tokens: [], isInfra: false, isEmpty: true };
  if (/^[—–-]$/.test(t)) return { tokens: [], isInfra: true, isEmpty: false };
  const tokens = [...t.matchAll(/rq\s*(\d+)/gi)].map((m) => `RQ${m[1]}`);
  return { tokens: [...new Set(tokens)], isInfra: false, isEmpty: tokens.length === 0 };
}

export function parseDecisionLog(raw: string): ParsedLogEntry[] {
  const entries: ParsedLogEntry[] = [];
  const re = /^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2})([^\n]*)$/gm;
  const matches = [...raw.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : raw.length;
    const body = raw.slice(start, end).trim();
    const fields: { label: string; text: string }[] = [];
    const fieldRe = /\*\*([^*]+):\*\*\s*([\s\S]*?)(?=\n\*\*[^*]+:\*\*|$)/g;
    for (const fm of body.matchAll(fieldRe)) {
      fields.push({ label: fm[1].trim(), text: fm[2].trim() });
    }
    entries.push({
      timestamp: m[1],
      lateCaptured: /late-captured/i.test(m[2]),
      autoCaptured: /auto-captured/i.test(m[2]),
      fields,
      raw: body,
    });
  }
  return entries;
}

// Reconstructed pre-adoption history. Headers are DATE-granularity (YYYY-MM or
// YYYY-MM-DD, never a clock time — the decision-log regex requires HH:MM, so the
// two never cross-parse). Month headers sort as the first of the month.
export function parseHistory(raw: string): ParsedHistoryEntry[] {
  const entries: ParsedHistoryEntry[] = [];
  const re = /^## (\d{4}-\d{2}(?:-\d{2})?)\s*[—–-]?\s*([^\n]*)$/gm;
  const matches = [...raw.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : raw.length;
    const body = raw.slice(start, end).trim();
    const fields: { label: string; text: string }[] = [];
    const fieldRe = /\*\*([^*]+):\*\*\s*([\s\S]*?)(?=\n\*\*[^*]+:\*\*|$)/g;
    for (const fm of body.matchAll(fieldRe)) {
      fields.push({ label: fm[1].trim(), text: fm[2].trim() });
    }
    const sortKey = m[1].length === 7 ? `${m[1]}-01` : m[1];
    entries.push({ date: m[1], sortKey, title: m[2].trim(), fields, raw: body });
  }
  return entries;
}

const EXEC_SECTIONS = [
  "Context",
  "Goal and success criteria",
  "Decisions",
  "Scope decisions", // legacy alias — older plans used this heading
  "Approach",
  "Build steps",
  "Verification",
  "Out of scope",
  "Files to reuse",
  "Sources",
];

// Reader detail level for the single-narrative plan (set per project in the
// master plan's `Detail level:` line). `compact` shows the CONTRACT sections;
// `standard` adds the METHOD sections; `full` additionally expands the inline
// agent-detail (<details class="agent-detail">) blocks. Every plan is authored
// in full — this only sets the board's default collapse, and any reader can
// toggle a section or block open. "Scope decisions" is the legacy alias of
// "Decisions" and is classified with it.
export const CONTRACT_SECTIONS = [
  "Context",
  "Goal and success criteria",
  "Decisions",
  "Scope decisions",
  "Out of scope",
];
export const METHOD_SECTIONS = [
  "Approach",
  "Build steps",
  "Verification",
  "Files to reuse",
  "Sources",
];

// Legacy classification for pre-v0.4 plans that still carry the "## Part 1 —" /
// "## Part 2 —" banners. Retained so those plans keep rendering with the old
// human/agent collapse; new single-narrative plans use the detail-level tiers
// above. (Deprecated — remove once no pre-v0.4 plans remain.)
export const HUMAN_SECTIONS = [
  "Goal and success criteria",
  "Context",
  "Scope decisions",
];
export const AGENT_SECTIONS = [
  "Approach",
  "Build steps",
  "Verification",
  "Out of scope",
  "Files to reuse",
];

export function parseExecutionPlan(raw: string): ParsedExecutionPlan {
  const trailer = parseTrailer(raw);
  const fail: ParsedExecutionPlan = {
    ok: false,
    title: "Analysis Plan",
    version: null,
    componentSlug: null,
    date: null,
    provenance: null,
    supersedes: null,
    masterPlan: null,
    goal: null,
    serves: null,
    sections: [],
    signedOff: null,
    trailerState: trailer.kind,
    raw,
  };
  try {
    const titleM = /^# (.+)$/m.exec(raw);
    const title = titleM?.[1]?.trim() ?? "Analysis Plan";
    const version = (() => {
      const m = /Execution Plan v(\d+)/i.exec(title);
      return m ? parseInt(m[1], 10) : null;
    })();
    const componentSlug =
      /^Component:\s*`?([^`·\n]+)`?/m.exec(raw)?.[1]?.trim() ?? null;
    const date = /(?:^|·\s*)Date:\s*([0-9-]+)/m.exec(raw)?.[1] ?? null;
    // Provenance: absent = prospective; "retrospective — covers <range>" otherwise.
    const provenance =
      /^Provenance:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? null;
    const supersedes =
      /^Supersedes:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? null;
    const masterPlan =
      /^(?:Component:.*?·\s*)?Master plan:\s*([^·\n]+)/m.exec(raw)?.[1]?.trim() ?? null;
    const signedOff =
      trailer.kind === "signed"
        ? trailer.line!.replace(/^Signed off:\s*/, "")
        : null;

    const sections: { heading: string; content: string }[] = [];
    for (const h of EXEC_SECTIONS) {
      const body = sectionBody(raw, h);
      if (body !== null) sections.push({ heading: h, content: body });
    }
    if (sections.length === 0) return fail;
    const goal = sectionBody(raw, "Goal and success criteria");
    const serves = goal
      ? (/^Serves:\s*(.+)$/m.exec(goal)?.[1]?.trim() ?? null)
      : null;
    return {
      ok: true,
      title,
      version,
      componentSlug,
      date,
      provenance,
      supersedes,
      masterPlan,
      goal,
      serves,
      sections,
      signedOff,
      trailerState: trailer.kind,
      raw,
    };
  } catch {
    return fail;
  }
}

const THRESHOLD_VERDICTS = ["pass", "undetermined", "fail"];

export function parseScorecard(raw: string): Scorecard | null {
  const m = /```json board-scorecard\s*\n([\s\S]*?)\n```/.exec(raw);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    if (!parsed || typeof parsed !== "object") return null;
    const sv = parsed.schemaVersion ?? 1;

    // schemaVersion 3 — the five-channel rubric, discriminated on `status`.
    if (sv >= 3) {
      if (parsed.status === "unscorable") {
        return typeof parsed.reason === "string" ? (parsed as Scorecard) : null;
      }
      if (parsed.status !== "scored" || !Array.isArray(parsed.channels)) return null;
      // Require exactly the five canonical channels, IN ORDER, each an integer
      // score 0..3. (All emitters write them in order; enforcing it keeps the
      // render — which indexes by position/letter — honest.)
      const ch = parsed.channels as { id?: unknown; score?: unknown }[];
      const orderOk =
        ch.length === SCORECARD_CHANNEL_IDS.length &&
        SCORECARD_CHANNEL_IDS.every((id, i) => ch[i] && ch[i].id === id);
      const scoresOk = ch.every(
        (c) =>
          Number.isInteger(c.score) &&
          (c.score as number) >= 0 &&
          (c.score as number) <= 3,
      );
      if (!orderOk || !scoresOk) return null;
      // total must equal the sum (derive when absent, reject when inconsistent).
      const sum = ch.reduce((a, c) => a + (c.score as number), 0);
      if (parsed.total == null) parsed.total = sum;
      else if (parsed.total !== sum) return null;
      // optional collections must be arrays; biggestLeak an object — else the
      // render's .map()/property access would throw on a malformed card.
      const okArr = (v: unknown) => v == null || Array.isArray(v);
      if (
        !okArr(parsed.integrityFlags) ||
        !okArr(parsed.suggestedMoves) ||
        !okArr(parsed.unresolvedForks)
      )
        return null;
      if (parsed.biggestLeak != null && typeof parsed.biggestLeak !== "object")
        return null;
      return parsed as Scorecard;
    }

    // Legacy v1/v2 — kept so old scorecards still render behind the "legacy
    // review" affordance. schemaVersion >= 2 REQUIRES a valid threshold block.
    if (!Array.isArray(parsed.items)) return null;
    if (sv >= 2) {
      const t = parsed.threshold;
      const valid =
        t &&
        typeof t === "object" &&
        THRESHOLD_VERDICTS.includes(t.verdict) &&
        Array.isArray(t.checks);
      if (!valid) return null;
    }
    return parsed as Scorecard;
  } catch {
    return null;
  }
}

// FNV-1a over sorted (path, content) pairs — stable across regenerations of the
// same artifact state; excludes generatedAt/git so pending local comments are
// not orphaned when the board is regenerated. board.py does not need to match
// this; it only echoes the client-sent hash back in the feedback document.
export function payloadContentHash(
  files: { path: string; content: string }[],
): string {
  const joined = files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => `${f.path}\n${f.content}`)
    .join("\n \n");
  let h = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function allFiles(data: {
  files: {
    masterPlan: { path: string; content: string };
    decisionLog: { path: string; content: string };
    executionPlans: {
      versions: { path: string; content: string }[];
      draft?: { path: string; content: string };
      draftSnapshots?: { path: string; content: string }[];
      results?: {
        manifestRaw: { path: string; content: string };
        report: { path: string; content: string } | null;
        verdictRaw: { path: string; content: string } | null;
        scripts: { path: string; content: string }[];
        publishedReport?: { path: string; content: string } | null;
      }[];
    }[];
    reviews: { path: string; content: string }[];
    history?: { path: string; content: string };
    archives?: { path: string; content: string }[];
    manuscript?: { path: string; content: string };
  };
}): { path: string; content: string }[] {
  const out = [data.files.masterPlan, data.files.decisionLog];
  for (const g of data.files.executionPlans) {
    out.push(...g.versions);
    out.push(...(g.draftSnapshots ?? []));
    if (g.draft) out.push(g.draft);
    for (const b of g.results ?? []) {
      out.push(b.manifestRaw);
      if (b.report) out.push(b.report);
      if (b.verdictRaw) out.push(b.verdictRaw);
      if (b.publishedReport) out.push(b.publishedReport);
      out.push(...b.scripts);
    }
  }
  out.push(...data.files.reviews);
  // Present-only: a project without history keeps a byte-identical hash.
  if (data.files.history) out.push(data.files.history);
  // Present-only, same rule: archived master plans (v0.10 renewal record).
  out.push(...(data.files.archives ?? []));
  // Present-only, same rule: the manuscript (Manuscript tab).
  if (data.files.manuscript) out.push(data.files.manuscript);
  return out;
}
