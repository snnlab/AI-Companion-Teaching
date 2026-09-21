// Cross-student similarity signal: k-shingling (k=8 words) + Jaccard
// similarity, pure set arithmetic, no embeddings/external calls — fully
// auditable, matching board/src/lib/authorship.ts's existing tone
// ("descriptive clue, never a verdict"). Never accuses, never auto-blocks.
//
// SCOPE DECISION (documented per the task brief, which allows either
// choice): this round compares only each pair of students' LATEST
// submission's full decision-log text. Per-plan-version comparison
// (component-to-component, matched by slug) is skipped — matching a
// differently-slugged "component 03" across two students isn't meaningful,
// and decision-log text alone already carries the strongest authorship
// signal (it's free-form prose, not a template-shaped document like a plan
// version). If a future round wants plan-body comparison too, add it
// alongside this function rather than inside it, grouped by matching slug.
import { normalizePlan } from "./reverify.js";
import { put, get } from "@vercel/blob";

export const SIMILARITY_SHINGLE_K = 8; // words per shingle

// Starting threshold, not a calibrated final value — an instructor should be
// able to tune this once real submission data exists. A module-level
// constant is deliberately simple for this round; an actual settings UI is
// out of scope (see the design plan's own framing of this as a first pass).
export const SIMILARITY_THRESHOLD = 0.35;

export interface SimilarityFlag {
  studentA: string;
  studentB: string;
  artifact: string; // always "decision-log" this round — see the scope decision above
  jaccard: number;
  sharedShingleCount: number;
  sampleSharedPhrase: string;
}

export interface SimilarityInput {
  studentId: string;
  decisionLogText: string;
}

export interface SimilarityResult {
  checkedAt: string;
  flags: SimilarityFlag[];
}

// lowercase, collapse whitespace, strip markdown punctuation, strip the
// sign-off trailer (reusing the ported normalize_plan — a no-op for
// decision-log text, which normally carries no trailer, but keeps this
// function correct if ever pointed at plan-version bodies too), and strip
// decision-log entry heading lines ("## YYYY-MM-DD HH:MM") and bare
// name/date-only lines, which are metadata, not authored content, and would
// otherwise inflate overlap between two students who simply worked the same
// week.
function normalizeForShingling(text: string): string {
  let normalized = normalizePlan(text).toLowerCase();
  normalized = normalized
    .split("\n")
    .filter((ln) => !/^#{1,6}\s*\d{4}-\d{2}-\d{2}([ t]\d{2}:\d{2})?\s*$/i.test(ln.trim()))
    .filter((ln) => !/^\d{4}-\d{2}-\d{2}\s*$/.test(ln.trim()))
    .join("\n");
  // Strip markdown punctuation: headers, emphasis markers, list/quote
  // markers, code fences, link brackets — comparing words, not markup.
  normalized = normalized.replace(/[`*_#>[\]()~-]/g, " ");
  normalized = normalized.replace(/\s+/g, " ").trim();
  return normalized;
}

function shingleSet(text: string, k: number): Set<string> {
  const words = text.length > 0 ? text.split(" ") : [];
  const set = new Set<string>();
  for (let i = 0; i + k <= words.length; i += 1) {
    set.add(words.slice(i, i + k).join(" "));
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): { score: number; intersection: string[] } {
  if (a.size === 0 || b.size === 0) return { score: 0, intersection: [] };
  const intersection: string[] = [];
  for (const x of a) if (b.has(x)) intersection.push(x);
  const unionSize = a.size + b.size - intersection.length;
  return { score: unionSize === 0 ? 0 : intersection.length / unionSize, intersection };
}

export function compareStudents(students: SimilarityInput[]): SimilarityFlag[] {
  const sets = students.map((s) => ({
    studentId: s.studentId,
    set: shingleSet(normalizeForShingling(s.decisionLogText), SIMILARITY_SHINGLE_K),
  }));
  const flags: SimilarityFlag[] = [];
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const a = sets[i];
      const b = sets[j];
      const { score, intersection } = jaccard(a.set, b.set);
      if (score >= SIMILARITY_THRESHOLD && intersection.length > 0) {
        const sample = intersection.slice().sort()[0];
        flags.push({
          studentA: a.studentId,
          studentB: b.studentId,
          artifact: "decision-log",
          jaccard: Math.round(score * 1000) / 1000,
          sharedShingleCount: intersection.length,
          sampleSharedPhrase: sample,
        });
      }
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Cache: similarity/latest.json. POST /api/similarity is the only writer
// (an instructor-triggered, O(N^2) comparison — never run automatically per
// submission, per the design plan). GET /api/roster and GET /api/similarity
// both read the cache; neither ever recomputes.
// ---------------------------------------------------------------------------

const CACHE_PATH = "similarity/latest.json";

export async function writeSimilarityCache(blobToken: string, result: SimilarityResult): Promise<void> {
  await put(CACHE_PATH, JSON.stringify(result), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
    token: blobToken,
  });
}

export async function readSimilarityCache(blobToken: string): Promise<SimilarityResult | null> {
  const result = await get(CACHE_PATH, { access: "private", token: blobToken });
  if (result?.statusCode !== 200) return null;
  try {
    return JSON.parse(await new Response(result.stream).text()) as SimilarityResult;
  } catch {
    return null;
  }
}
