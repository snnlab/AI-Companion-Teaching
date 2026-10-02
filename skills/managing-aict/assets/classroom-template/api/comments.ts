// GET  /api/comments?shareHash=<hash> — list comments for one submission.
//      Instructor session (any student's shareHash) OR the owning student's
//      own bearer token (their own shareHash only — checked against the
//      submission-index, never trusted from the query string).
// POST /api/comments — instructor session only. The board's existing
//      comment-posting code (board/src/lib/hostedComments.ts,
//      board/src/App.tsx's saveHosted) already sends exactly this body
//      shape for "hosted" mode; Roster.tsx marks a drilled-into student's
//      payload as mode "hosted" specifically so that code path fires
//      unmodified here — see Roster.tsx's own comment on why.
// PATCH  /api/comments?shareHash=&id= — instructor only: change a sent
//      comment's text ({comment, category?}); stamps editedAt.
// DELETE /api/comments?shareHash=&id= — instructor only: remove a comment.
//      The middleware lets /api/comments through for students' bearer GET,
//      so both methods check the instructor session here themselves.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthed, type HeaderBag } from "../lib/auth.js";
import { SECURITY_HEADERS } from "../lib/gate.js";
import { COMMENT_ID_RE, validateCommentBody, validateCommentPatch } from "../lib/validate.js";
import {
  deleteComment,
  listCommentsForShareHash,
  putComment,
  updateComment,
  type StoredComment,
} from "../lib/comments.js";
import { resolveToken } from "../lib/roster.js";
import { resolveShareHashOwner } from "../lib/submissions.js";
import { getRelease } from "../lib/release.js";

export interface RunResult { status: number; json: unknown }

function bearerToken(headers: HeaderBag): string | null {
  const raw = headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

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
  const blobToken = env.BLOB_READ_WRITE_TOKEN as string;
  const instructor = isAuthed({ BOARD_SESSION_SECRET: env.BOARD_SESSION_SECRET }, headers, now);

  if (method === "GET") {
    const shareHash = firstQueryValue(query.shareHash);
    if (!shareHash) return { status: 400, json: { error: "shareHash query parameter is required" } };

    if (instructor) {
      // The instructor may read comments on any student's submission — no
      // further ownership check needed once the session cookie is valid.
      const comments = await listCommentsForShareHash(blobToken, shareHash);
      return { status: 200, json: { comments } };
    }

    const token = bearerToken(headers);
    if (!token) return { status: 401, json: { error: "unauthorized" } };
    const pepper = env.ROSTER_TOKEN_PEPPER ?? "";
    const studentId = await resolveToken(blobToken, pepper, token);
    if (!studentId) return { status: 401, json: { error: "invalid_token" } };
    // A student may only ever read comments on THEIR OWN submission — never
    // trust the query string's shareHash alone; confirm it actually belongs
    // to this student via the server-written index before returning anything.
    const owner = await resolveShareHashOwner(blobToken, shareHash);
    if (owner !== studentId) return { status: 403, json: { error: "forbidden" } };
    // Unreleased feedback is the instructor's work in progress — same rule as
    // /api/my-comments.
    const release = await getRelease(blobToken, shareHash);
    if (!release?.releasedAt) return { status: 200, json: { comments: [] } };
    const comments = await listCommentsForShareHash(blobToken, shareHash);
    return { status: 200, json: { comments } };
  }

  if (method === "POST") {
    // Only the instructor's browser ever POSTs here — students never receive
    // a browser session this round (see lib/auth.ts's own note), so a bearer
    // token can never legitimately reach this branch.
    if (!instructor) return { status: 401, json: { error: "unauthorized" } };
    let parsed: unknown = body;
    if (typeof body === "string") {
      try { parsed = JSON.parse(body); } catch { return { status: 400, json: { error: "bad json" } }; }
    }
    const v = validateCommentBody(parsed);
    if (!v.ok) return { status: 400, json: { error: "invalid", detail: v.error } };
    // Reject a comment for a shareHash that doesn't correspond to any known
    // submission — never write orphaned comment state for a forged hash.
    const owner = await resolveShareHashOwner(blobToken, v.value.shareHash);
    if (!owner) return { status: 400, json: { error: "unknown shareHash" } };
    const stored: StoredComment = {
      id: v.value.id, clientId: v.value.clientId, author: v.value.author,
      shareHash: v.value.shareHash, docHash: v.value.docHash ?? null,
      annotation: v.value.annotation, receivedAt: new Date().toISOString(),
    };
    const outcome = await putComment(blobToken, stored);
    if (outcome === "conflict") {
      return { status: 409, json: { error: "comment id already exists with different content" } };
    }
    return { status: 200, json: { ok: true, id: stored.id } };
  }

  if (method === "PATCH" || method === "DELETE") {
    if (!instructor) return { status: 401, json: { error: "unauthorized" } };
    const shareHash = firstQueryValue(query.shareHash);
    const id = firstQueryValue(query.id);
    if (!shareHash || shareHash.length > 200 || !id || !COMMENT_ID_RE.test(id)) {
      return { status: 400, json: { error: "shareHash and a comment id are required" } };
    }
    if (method === "DELETE") {
      await deleteComment(blobToken, shareHash, id);
      return { status: 200, json: { ok: true, id } };
    }
    let parsed: unknown = body;
    if (typeof body === "string") {
      try { parsed = JSON.parse(body); } catch { return { status: 400, json: { error: "bad json" } }; }
    }
    const v = validateCommentPatch(parsed);
    if (!v.ok) return { status: 400, json: { error: "invalid", detail: v.error } };
    const updated = await updateComment(blobToken, shareHash, id, v.value, new Date(now * 1000).toISOString());
    if (!updated) return { status: 404, json: { error: "not_found" } };
    return { status: 200, json: { ok: true, comment: updated } };
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
