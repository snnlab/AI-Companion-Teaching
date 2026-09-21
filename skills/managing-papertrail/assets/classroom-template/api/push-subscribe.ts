// POST   /api/push-subscribe — register a browser push subscription for the
//        calling student. Bearer token only (their own token, same as
//        /api/my-comments). Body is the JSON a PushManager.subscribe()
//        returns: { endpoint, keys: { p256dh, auth } }.
// DELETE /api/push-subscribe — remove one subscription (body { endpoint }),
//        used when the student turns notifications off.
//
// Not in the instructor-cookie gate: this route authenticates itself with
// the student bearer token, exactly like /api/my-comments. Keep it in
// middleware.ts's / lib/gate.ts's bearer-exempt list.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SECURITY_HEADERS } from "../lib/gate.js";
import { resolveToken } from "../lib/roster.js";
import { putSub, deleteSubByEndpoint, isPushSubscription } from "../lib/push.js";

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
  body: unknown,
  env: Record<string, string | undefined>,
): Promise<RunResult> {
  if (method !== "POST" && method !== "DELETE") {
    return { status: 405, json: { error: "method not allowed" } };
  }
  const token = bearerToken(headers);
  if (!token) return { status: 401, json: { error: "invalid_token" } };

  const blobToken = env.BLOB_READ_WRITE_TOKEN as string;
  const pepper = env.ROSTER_TOKEN_PEPPER ?? "";
  const studentId = await resolveToken(blobToken, pepper, token);
  if (!studentId) return { status: 401, json: { error: "invalid_token" } };

  let parsed: unknown = body;
  if (typeof body === "string") {
    try { parsed = JSON.parse(body); } catch { return { status: 400, json: { error: "bad json" } }; }
  }

  if (method === "DELETE") {
    const endpoint = (parsed as { endpoint?: unknown })?.endpoint;
    if (typeof endpoint !== "string") return { status: 400, json: { error: "endpoint required" } };
    await deleteSubByEndpoint(blobToken, studentId, endpoint);
    return { status: 200, json: { ok: true } };
  }

  if (!isPushSubscription(parsed)) {
    return { status: 400, json: { error: "not a valid push subscription" } };
  }
  await putSub(blobToken, studentId, parsed);
  return { status: 200, json: { ok: true } };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const r = await run(req.method ?? "POST", req.headers as HeaderBag, req.body, process.env);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.status(r.status).json(r.json);
}
