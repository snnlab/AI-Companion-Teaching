import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthed, type HeaderBag } from "../lib/auth.js";
import { validateCommentBody } from "../lib/validate.js";
import { SECURITY_HEADERS } from "../lib/gate.js";
import { putComment, listComments, type StoredComment } from "../lib/blobstore.js";

export interface RunResult { status: number; json: unknown; }

export async function run(method: string, headers: HeaderBag, body: unknown, env: Record<string, string | undefined>, now: number): Promise<RunResult> {
  if (!isAuthed(env, headers, now)) return { status: 401, json: { error: "unauthorized" } };
  const token = env.BLOB_READ_WRITE_TOKEN as string;
  if (method === "GET") {
    const comments = await listComments(token);
    return { status: 200, json: { comments } };
  }
  if (method === "POST") {
    let parsed: unknown = body;
    if (typeof body === "string") { try { parsed = JSON.parse(body); } catch { return { status: 400, json: { error: "bad json" } }; } }
    const v = validateCommentBody(parsed);
    if (!v.ok) return { status: 400, json: { error: "invalid", detail: v.error } };
    const stored: StoredComment = { id: v.value.id, clientId: v.value.clientId, author: v.value.author, shareHash: v.value.shareHash, docHash: v.value.docHash ?? null, annotation: v.value.annotation, receivedAt: new Date().toISOString() };
    const outcome = await putComment(token, stored);
    if (outcome === "conflict") {
      return { status: 409, json: { error: "comment id already exists with different content" } };
    }
    return { status: 200, json: { ok: true, id: stored.id } };
  }
  return { status: 405, json: { error: "method not allowed" } };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const r = await run(req.method ?? "GET", req.headers as HeaderBag, req.body, process.env, Math.floor(Date.now() / 1000));
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.status(r.status).json(r.json);
}
