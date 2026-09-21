import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthed, type HeaderBag } from "../lib/auth.js";
import { SECURITY_HEADERS } from "../lib/gate.js";
import { list, del } from "@vercel/blob";

export interface ClearResult { status: number; json: unknown; }

export async function run(method: string, headers: HeaderBag, env: Record<string, string | undefined>, now: number): Promise<ClearResult> {
  if (!isAuthed(env, headers, now)) return { status: 401, json: { error: "unauthorized" } };
  // CSRF guard: this is a destructive delete-all. A SameSite=Lax session cookie
  // is sent on a top-level GET navigation, so an unguarded GET to /api/clear
  // would wipe every comment. Require POST, exactly as /api/comments does.
  if (method !== "POST") return { status: 405, json: { error: "method not allowed" } };
  const token = env.BLOB_READ_WRITE_TOKEN as string;
  let cursor: string | undefined;
  let n = 0;
  do {
    const page = await list({ token, prefix: "comments/", cursor, limit: 1000 });
    for (const b of page.blobs) { await del(b.url, { token }); n++; }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return { status: 200, json: { ok: true, deleted: n } };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const r = await run(req.method ?? "GET", req.headers as HeaderBag, process.env, Math.floor(Date.now() / 1000));
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.status(r.status).json(r.json);
}
