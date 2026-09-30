// GET /api/submissions/:studentId            — the list of one student's
//                                               submissions (newest first),
//                                               metadata only.
// GET /api/submissions/:studentId?key=<key>  — ONE submission in full.
//
// Instructor-only (gated by the instructor_session cookie, both at the
// middleware layer and again here — defense in depth, matching
// web-template's api/comments.ts and api/clear.ts, which both re-check
// isAuthed even though middleware already gated the request).
//
// Split in two because a Vercel Function response is capped at 4.5 MB: the
// old single response carried every submission's whole payload, so a student
// with a few large submissions could not be opened at all.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthed, type HeaderBag } from "../../lib/auth.js";
import { SECURITY_HEADERS } from "../../lib/gate.js";
import { getStudent } from "../../lib/roster.js";
import { getSubmission, listSubmissionMeta } from "../../lib/submissions.js";
import { IDEMPOTENCY_KEY_RE } from "../../lib/validate.js";
import { str } from "../../lib/reverify.js";

export interface RunResult { status: number; json: unknown }

export async function run(
  method: string,
  headers: HeaderBag,
  studentId: string,
  key: string | null,
  env: Record<string, string | undefined>,
  now: number,
): Promise<RunResult> {
  if (!isAuthed({ BOARD_SESSION_SECRET: env.BOARD_SESSION_SECRET }, headers, now)) {
    return { status: 401, json: { error: "unauthorized" } };
  }
  if (method !== "GET") return { status: 405, json: { error: "method not allowed" } };

  const blobToken = env.BLOB_READ_WRITE_TOKEN as string;
  const entry = await getStudent(blobToken, studentId);
  if (!entry) return { status: 404, json: { error: "not_found" } };

  if (key !== null) {
    if (!IDEMPOTENCY_KEY_RE.test(key)) return { status: 400, json: { error: "bad key" } };
    const s = await getSubmission(blobToken, studentId, key);
    if (!s) return { status: 404, json: { error: "not_found" } };
    return {
      status: 200,
      json: { submittedAt: s.submittedAt, idempotencyKey: s.idempotencyKey, payload: s.payload },
    };
  }

  const submissions = await listSubmissionMeta(blobToken, studentId); // newest-first
  return {
    status: 200,
    json: { studentId, displayName: entry.displayName, submissions },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const query = req.query as Record<string, unknown>;
  const studentId = str(query.studentId) ?? "";
  const r = await run(
    req.method ?? "GET",
    req.headers as HeaderBag,
    studentId,
    str(query.key),
    process.env,
    Math.floor(Date.now() / 1000),
  );
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.status(r.status).json(r.json);
}
