// GET /api/my-comments — every comment across ALL of the calling student's
// own submissions, in one call. Bearer-token only; there is no instructor
// use for this route (the instructor already gets a per-student view via
// GET /api/submissions/:studentId + GET /api/comments?shareHash=).
//
// Exists because /aict:check (unlike the old submit.py-embedded
// comment check it replaces) must not depend on the student's local
// bookkeeping to know which shareHashes they've ever submitted — a second
// machine or a fresh install would silently lose that memory and miss
// comments left on an older submission. This route asks the server instead,
// which already knows the student's full submission history.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SECURITY_HEADERS } from "../lib/gate.js";
import { resolveToken } from "../lib/roster.js";
import { listSubmissionsForStudent } from "../lib/submissions.js";
import { listCommentsForShareHash, type StoredComment } from "../lib/comments.js";
import { getRelease } from "../lib/release.js";

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
  env: Record<string, string | undefined>,
): Promise<RunResult> {
  if (method !== "GET") return { status: 405, json: { error: "method not allowed" } };

  const token = bearerToken(headers);
  if (!token) return { status: 401, json: { error: "invalid_token" } };

  const blobToken = env.BLOB_READ_WRITE_TOKEN as string;
  const pepper = env.ROSTER_TOKEN_PEPPER ?? "";
  const studentId = await resolveToken(blobToken, pepper, token);
  if (!studentId) return { status: 401, json: { error: "invalid_token" } };

  const stored = await listSubmissionsForStudent(blobToken, studentId);
  const shareHashes = Array.from(new Set(stored.map((s) => s.idempotencyKey)));

  const perSubmission = await Promise.all(
    shareHashes.map((sh) => listCommentsForShareHash(blobToken, sh)),
  );
  const comments: StoredComment[] = perSubmission.flat();
  comments.sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0));

  // Per-submission "released" state — the /me page uses releasedAt both to
  // decide what to show at all (nothing until the instructor clicks "학생에게
  // 피드백 보내기") and to compute its "new feedback" badge. /aict:check
  // ignores this list and still pulls every comment; releasing only gates the
  // passive web notification, never the explicit student-initiated pull.
  const releases = await Promise.all(shareHashes.map((sh) => getRelease(blobToken, sh)));
  const byKey = new Map(
    stored.map((s) => [s.idempotencyKey, s.submittedAt] as const),
  );
  const submissions = shareHashes.map((sh, i) => ({
    shareHash: sh,
    submittedAt: byKey.get(sh) ?? null,
    releasedAt: releases[i]?.releasedAt ?? null,
  }));

  return { status: 200, json: { studentId, comments, submissions } };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const r = await run(req.method ?? "GET", req.headers as HeaderBag, process.env);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.status(r.status).json(r.json);
}
