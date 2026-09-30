// GET /api/roster  — full roster summary, instructor-only.
// POST /api/roster — register a new student / mint (or rotate) a token,
//                     instructor-only. See lib/roster.ts's upsertStudent for
//                     why registration and rotation share this one route.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthed, type HeaderBag } from "../lib/auth.js";
import { SECURITY_HEADERS } from "../lib/gate.js";
import { listRoster, upsertStudent, getLastViewed, setLastViewed, STUDENT_ID_RE, type RosterEntry } from "../lib/roster.js";
import { listSubmissionMeta } from "../lib/submissions.js";
import {
  readSummary,
  updateSummary,
  writeNewSummary,
  type RosterSummary,
  type SummaryRow,
} from "../lib/rosterSummary.js";

export interface RunResult { status: number; json: unknown }

// Rebuild the roster summary from the source records — the first load after
// an upgrade, or after the summary was dropped. One read per student plus
// their submission index (built once from a full sweep for a student whose
// submissions predate it). Every later load reads the summary alone.
async function rebuildSummary(blobToken: string): Promise<RosterSummary> {
  const roster = await listRoster(blobToken);
  const rows = await Promise.all(
    roster.map(async (entry: RosterEntry) => {
      const meta = await listSubmissionMeta(blobToken, entry.studentId);
      const row: SummaryRow = {
        displayName: entry.displayName,
        lastSubmission: meta[0] ? { submittedAt: meta[0].submittedAt, idempotencyKey: meta[0].idempotencyKey } : null,
        submissionCount: meta.length,
      };
      return [entry.studentId, row] as const;
    }),
  );
  const summary: RosterSummary = { version: 1, students: Object.fromEntries(rows) };
  await writeNewSummary(blobToken, summary);
  return summary;
}

export async function run(
  method: string,
  headers: HeaderBag,
  body: unknown,
  env: Record<string, string | undefined>,
  now: number,
): Promise<RunResult> {
  if (!isAuthed({ BOARD_SESSION_SECRET: env.BOARD_SESSION_SECRET }, headers, now)) {
    return { status: 401, json: { error: "unauthorized" } };
  }
  const blobToken = env.BLOB_READ_WRITE_TOKEN as string;

  if (method === "GET") {
    const summary = (await readSummary(blobToken))?.summary ?? (await rebuildSummary(blobToken));
    // Read the PREVIOUS last-viewed pointer before this view overwrites it —
    // every row's isNewSinceLastView is computed against the value as of the
    // instructor's prior visit, not this one, or every row would read as
    // "not new" the instant they're first seen.
    const lastViewed = await getLastViewed(blobToken);
    const students = Object.entries(summary.students).map(([studentId, row]) => ({
      studentId,
      displayName: row.displayName,
      lastSubmission: row.lastSubmission,
      submissionCount: row.submissionCount,
      // Compared as instants, not strings: submittedAt carries the STUDENT's
      // local offset (e.g. +09:00); lastViewed is this server's UTC 'Z'.
      isNewSinceLastView: !!(
        row.lastSubmission
        && (!lastViewed || Date.parse(row.lastSubmission.submittedAt) > Date.parse(lastViewed))
      ),
    }));
    students.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
    const generatedAt = new Date().toISOString();
    await setLastViewed(blobToken, generatedAt);
    return {
      status: 200,
      json: {
        schemaVersion: 1,
        course: {
          id: env.COURSE_ID ?? "course",
          // Shown as the default comment author when the instructor drills
          // into a student's board — one login, one commenter, so the name
          // field should not start blank (a blank field silently disables
          // the Save button). Optional: unset -> the field still works, it
          // just starts empty as before.
          instructorName: env.COURSE_INSTRUCTOR_NAME ?? null,
        },
        generatedAt,
        students,
      },
    };
  }

  if (method === "POST") {
    const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    const studentId = b.studentId;
    const displayName = b.displayName;
    if (typeof studentId !== "string" || !STUDENT_ID_RE.test(studentId)) {
      return { status: 400, json: { error: "invalid studentId" } };
    }
    if (typeof displayName !== "string" || displayName.trim().length === 0 || displayName.length > 200) {
      return { status: 400, json: { error: "invalid displayName" } };
    }
    const pepper = env.ROSTER_TOKEN_PEPPER ?? "";
    const { token } = await upsertStudent(blobToken, pepper, studentId, displayName);
    // Keep the roster summary in step: a new student appears with no
    // submissions; a re-registration (token rotation) keeps theirs.
    await updateSummary(blobToken, (s) => {
      const existing = s.students[studentId];
      s.students[studentId] = {
        displayName,
        lastSubmission: existing?.lastSubmission ?? null,
        submissionCount: existing?.submissionCount ?? 0,
      };
      return true;
    });
    return { status: 200, json: { studentId, displayName, token } };
  }

  return { status: 405, json: { error: "method not allowed" } };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const r = await run(
    req.method ?? "GET",
    req.headers as HeaderBag,
    req.body,
    process.env,
    Math.floor(Date.now() / 1000),
  );
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.status(r.status).json(r.json);
}
