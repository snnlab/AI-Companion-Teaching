// POST /api/release  — instructor-only. Body { shareHash, by? }. Marks one
//   submission's feedback as "released to the student": the drilled-in
//   board's "학생에게 피드백 보내기" (Send feedback to the student) button
//   calls this. Until it is set, the student's /me page shows nothing for
//   that submission.
// GET  /api/release?shareHash=<hash>  — instructor-only. Returns
//   { releasedAt, by } | { releasedAt: null } so the board button can show
//   whether feedback was already sent.
//
// This route is NOT in middleware.ts's / lib/gate.ts's bearer-exempt list on
// purpose: it is a pure instructor action, gated by the instructor session
// cookie exactly like GET/POST /api/roster.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthed, type HeaderBag } from "../lib/auth.js";
import { SECURITY_HEADERS } from "../lib/gate.js";
import { IDEMPOTENCY_KEY_RE } from "../lib/validate.js";
import { resolveShareHashOwner } from "../lib/submissions.js";
import { getRelease, putRelease } from "../lib/release.js";
import { readVapid, sendToStudent } from "../lib/push.js";

export interface RunResult { status: number; json: unknown }

function firstQueryValue(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export async function run(
  method: string,
  headers: HeaderBag,
  query: Record<string, string | string[] | undefined>,
  body: unknown,
  env: Record<string, string | undefined>,
  now: number,
): Promise<RunResult> {
  if (!isAuthed({ BOARD_SESSION_SECRET: env.BOARD_SESSION_SECRET }, headers, now)) {
    return { status: 401, json: { error: "unauthorized" } };
  }
  const blobToken = env.BLOB_READ_WRITE_TOKEN as string;

  if (method === "GET") {
    const shareHash = firstQueryValue(query.shareHash);
    if (!shareHash || !IDEMPOTENCY_KEY_RE.test(shareHash)) {
      return { status: 400, json: { error: "shareHash query parameter is required" } };
    }
    const marker = await getRelease(blobToken, shareHash);
    return { status: 200, json: marker ?? { releasedAt: null } };
  }

  if (method === "POST") {
    let parsed: unknown = body;
    if (typeof body === "string") {
      try { parsed = JSON.parse(body); } catch { return { status: 400, json: { error: "bad json" } }; }
    }
    const b = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
    const shareHash = b.shareHash;
    if (typeof shareHash !== "string" || !IDEMPOTENCY_KEY_RE.test(shareHash)) {
      return { status: 400, json: { error: "invalid shareHash" } };
    }
    const by = typeof b.by === "string" && b.by.trim().length > 0 && b.by.length <= 120
      ? b.by.trim()
      : (env.COURSE_INSTRUCTOR_NAME ?? null);
    // Never write a release marker for a shareHash that names no known
    // submission — same guard api/comments.ts applies before putComment.
    const owner = await resolveShareHashOwner(blobToken, shareHash);
    if (!owner) return { status: 400, json: { error: "unknown shareHash" } };
    const marker = await putRelease(blobToken, shareHash, by, new Date(now * 1000));

    // Best-effort web push. Never let a notification failure fail the
    // release — the /me page is the always-there fallback.
    let push: { sent: number; pruned: number } | null = null;
    const vapid = readVapid(env);
    if (vapid) {
      try {
        const base = env.VERCEL_PROJECT_PRODUCTION_URL
          ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
          : "";
        push = await sendToStudent(blobToken, owner, vapid, {
          title: "새 피드백",
          body: `${by ?? "교수자"}님이 피드백을 보냈습니다.`,
          url: `${base}/me`,
        });
      } catch {
        push = null;
      }
    }
    return { status: 200, json: { ok: true, ...marker, push } };
  }

  return { status: 405, json: { error: "method not allowed" } };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const r = await run(
    req.method ?? "GET",
    req.headers as HeaderBag,
    req.query as Record<string, string | string[] | undefined>,
    req.body,
    process.env,
    Math.floor(Date.now() / 1000),
  );
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.status(r.status).json(r.json);
}
