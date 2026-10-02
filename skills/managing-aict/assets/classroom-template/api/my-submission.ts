// GET /api/my-submission?key=<shareHash> — one of the calling student's OWN
// submissions in full, for the read-only history board (/me/board and
// /ait:check --open). Bearer-token only. Only a submission whose feedback the
// instructor has released is served: the history board exists to show that
// feedback in place, and unreleased feedback is still work in progress.
//
// One submission per call for the same reason as GET /api/submissions/:id
// ?key= — a Vercel Function response is capped at 4.5 MB, and a stored
// envelope is kept under 4.4 MB by submit.py.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SECURITY_HEADERS } from "../lib/gate.js";
import { resolveToken } from "../lib/roster.js";
import { getSubmission } from "../lib/submissions.js";
import { getRelease } from "../lib/release.js";
import { IDEMPOTENCY_KEY_RE } from "../lib/validate.js";
import { str } from "../lib/reverify.js";

export interface RunResult { status: number; json: unknown }

export type HeaderBag = Record<string, string | string[] | undefined>;

function bearerToken(headers: HeaderBag): string | null {
  const raw = headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function run(
  method: string,
  headers: HeaderBag,
  key: string | null,
  env: Record<string, string | undefined>,
): Promise<RunResult> {
  if (method !== "GET") return { status: 405, json: { error: "method not allowed" } };
  const token = bearerToken(headers);
  if (!token) return { status: 401, json: { error: "invalid_token" } };
  if (!key || !IDEMPOTENCY_KEY_RE.test(key)) return { status: 400, json: { error: "bad key" } };

  const blobToken = env.BLOB_READ_WRITE_TOKEN as string;
  const studentId = await resolveToken(blobToken, env.ROSTER_TOKEN_PEPPER ?? "", token);
  if (!studentId) return { status: 401, json: { error: "invalid_token" } };

  // Looked up under the caller's own id, so another student's key is simply
  // not found — never a different student's submission.
  const s = await getSubmission(blobToken, studentId, key);
  if (!s) return { status: 404, json: { error: "not_found" } };
  const release = await getRelease(blobToken, key);
  if (!release?.releasedAt) return { status: 403, json: { error: "not_released" } };

  return {
    status: 200,
    json: {
      studentId,
      submittedAt: s.submittedAt,
      idempotencyKey: s.idempotencyKey,
      releasedAt: release.releasedAt,
      payload: s.payload,
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const query = req.query as Record<string, unknown>;
  const r = await run(req.method ?? "GET", req.headers as HeaderBag, str(query.key), process.env);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.status(r.status).json(r.json);
}
