// GET /api/submissions/:studentId — one student's full submission history,
// instructor-only (gated by the instructor_session cookie, both at the
// middleware layer and again here — defense in depth, matching
// web-template's api/comments.ts and api/clear.ts, which both re-check
// isAuthed even though middleware already gated the request).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthed, type HeaderBag } from "../../lib/auth.js";
import { SECURITY_HEADERS } from "../../lib/gate.js";
import { getStudent } from "../../lib/roster.js";
import { listSubmissionsForStudent } from "../../lib/submissions.js";
import { findFreshestManifest, isRecord, str } from "../../lib/reverify.js";

export interface RunResult { status: number; json: unknown }

export async function run(
  method: string,
  headers: HeaderBag,
  studentId: string,
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

  const stored = await listSubmissionsForStudent(blobToken, studentId); // already newest-first
  const submissions = stored.map((s) => {
    const manifest = findFreshestManifest(s.payload);
    const score = manifest && isRecord(manifest.score) ? manifest.score : null;
    const integrityStatus = manifest && isRecord(manifest.integrity) && typeof manifest.integrity.status === "string"
      ? (manifest.integrity.status as "passed" | "failed")
      : "unknown";
    return {
      submittedAt: s.submittedAt,
      idempotencyKey: s.idempotencyKey,
      reverify: s.reverify,
      score,
      integrityStatus,
      payload: s.payload,
    };
  });

  return {
    status: 200,
    json: { studentId, displayName: entry.displayName, submissions },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const studentId = str((req.query as Record<string, unknown>).studentId) ?? "";
  const r = await run(
    req.method ?? "GET",
    req.headers as HeaderBag,
    studentId,
    process.env,
    Math.floor(Date.now() / 1000),
  );
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.status(r.status).json(r.json);
}
