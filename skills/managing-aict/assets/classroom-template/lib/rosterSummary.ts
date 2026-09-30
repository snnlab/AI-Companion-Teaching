// One small blob that answers GET /api/roster on its own:
//
//   roster-meta/summary.json   {version, students: {studentId: {displayName, lastSubmission, submissionCount}}}
//
// Why: Blob usage on the Hobby plan is metered per operation (10,000 simple
// reads and 2,000 writes/lists a month, with the store locked for 30 days
// once exceeded). Reading one blob per student on every dashboard load made
// that budget shrink with class size; this makes a load cost the same for 5
// students or 500.
//
// It is a CACHE of the per-student records (roster/<id>.json and
// submissions/<id>/_index.json), never the source of truth. Writers update it
// with an ETag-conditional write and retry on a concurrent change; if that
// still fails, or a student it should hold is missing, it is deleted and the
// next roster load rebuilds it from the source records. Deleting it by hand
// (e.g. after removing a student's blobs) is always safe.
import { put, get, del } from "@vercel/blob";

export const SUMMARY_PATH = "roster-meta/summary.json";
const MAX_TRIES = 6;

export interface SummaryRow {
  displayName: string;
  lastSubmission: { submittedAt: string; idempotencyKey: string } | null;
  submissionCount: number;
  // When the instructor last opened this student's board (drill-in). A row
  // is "new" when its latest submission is later than this. Absent/null =
  // never opened.
  viewedAt?: string | null;
}

export interface RosterSummary {
  version: 1;
  students: Record<string, SummaryRow>;
}

function isSummary(v: unknown): v is RosterSummary {
  return !!v && typeof v === "object" && (v as RosterSummary).version === 1
    && !!(v as RosterSummary).students && typeof (v as RosterSummary).students === "object";
}

// `fresh` bypasses the CDN cache — required before a read-modify-write.
export async function readSummary(
  blobToken: string,
  fresh = false,
): Promise<{ summary: RosterSummary; etag: string | null } | null> {
  const result = await get(SUMMARY_PATH, { access: "private", token: blobToken, ...(fresh ? { useCache: false } : {}) });
  if (result?.statusCode !== 200) return null;
  try {
    const parsed = JSON.parse(await new Response(result.stream).text());
    if (!isSummary(parsed)) return null;
    const etag = (result as { blob?: { etag?: string } }).blob?.etag ?? null;
    return { summary: parsed, etag };
  } catch {
    return null;
  }
}

// Create-only: if another request built it first, theirs stands.
export async function writeNewSummary(blobToken: string, summary: RosterSummary): Promise<void> {
  try {
    await put(SUMMARY_PATH, JSON.stringify(summary), {
      access: "private", allowOverwrite: false, contentType: "application/json", token: blobToken,
    });
  } catch {
    /* already exists — fine */
  }
}

export async function dropSummary(blobToken: string): Promise<void> {
  await del(SUMMARY_PATH, { token: blobToken }).catch(() => {});
}

// Apply `mutate` to the stored summary. Does nothing when there is no
// summary yet — the next roster load builds a complete one (creating it here
// from a single student would hide everyone else). `mutate` returns false to
// signal the summary cannot be patched (e.g. it lacks the student), which
// drops it for a rebuild.
export async function updateSummary(
  blobToken: string,
  mutate: (s: RosterSummary) => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const current = await readSummary(blobToken, true);
    if (!current) return;
    if (!mutate(current.summary)) {
      await dropSummary(blobToken);
      return;
    }
    try {
      await put(SUMMARY_PATH, JSON.stringify(current.summary), {
        access: "private",
        contentType: "application/json",
        token: blobToken,
        ...(current.etag ? { ifMatch: current.etag } : { allowOverwrite: true }),
      });
      return;
    } catch {
      // A concurrent writer changed it between our read and write — reread.
    }
  }
  await dropSummary(blobToken);
}
