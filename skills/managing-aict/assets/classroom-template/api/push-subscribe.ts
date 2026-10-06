// GET    /api/push-subscribe — the VAPID *public* key, for the /me page's
//        pushManager.subscribe() call. Public by definition (it is the
//        "application server key" browsers embed in the subscription), so
//        no auth. { key: null } when web push is not configured, so the
//        page can hide its "Notify me" button. Also reachable as
//        /api/vapid-public-key (a vercel.json rewrite; it used to be a
//        function of its own, folded in here to stay under the Hobby
//        plan's 12-function limit).
// POST   /api/push-subscribe — register a browser push subscription for the
//        calling student. Bearer token only (their own token, same as
//        /api/my-comments). Body is the JSON a PushManager.subscribe()
//        returns: { endpoint, keys: { p256dh, auth } }.
// DELETE /api/push-subscribe — remove one subscription (body { endpoint }),
//        used when the student turns notifications off.
// POST   /api/push-subscribe?test=1 — send a test notification to every
//        device the calling student has registered, and answer
//        { ok, sent, pruned }. The /me page's "Send a test notification"
//        button: lets a student check, on the spot, that notifications reach
//        this device (or learn that the server holds none for them).
//
// Not in the instructor-cookie gate: this route authenticates itself with
// the student bearer token, exactly like /api/my-comments. Keep it in
// middleware.ts's / lib/gate.ts's bearer-exempt list.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SECURITY_HEADERS } from "../lib/gate.js";
import { resolveToken } from "../lib/roster.js";
import {
  putSub,
  deleteSubByEndpoint,
  isPushSubscription,
  readVapid,
  sendToStudent,
} from "../lib/push.js";

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
  opts: { test?: boolean } = {},
): Promise<RunResult> {
  if (method === "GET") return { status: 200, json: { key: env.VAPID_PUBLIC_KEY ?? null } };
  if (method !== "POST" && method !== "DELETE") {
    return { status: 405, json: { error: "method not allowed" } };
  }
  const token = bearerToken(headers);
  if (!token) return { status: 401, json: { error: "invalid_token" } };

  const blobToken = env.BLOB_READ_WRITE_TOKEN as string;
  const pepper = env.ROSTER_TOKEN_PEPPER ?? "";
  const studentId = await resolveToken(blobToken, pepper, token);
  if (!studentId) return { status: 401, json: { error: "invalid_token" } };

  if (method === "POST" && opts.test) {
    const vapid = readVapid(env);
    if (!vapid) return { status: 400, json: { error: "push_not_configured" } };
    const base = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "";
    const r = await sendToStudent(blobToken, studentId, vapid, {
      title: "Test notification",
      body: "Notifications from your classroom reach this device.",
      url: `${base}/me`,
      tag: "aict-test",
    });
    return { status: 200, json: { ok: true, ...r } };
  }

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
  const test = (req.query as Record<string, unknown> | undefined)?.test !== undefined;
  const r = await run(req.method ?? "POST", req.headers as HeaderBag, req.body, process.env, { test });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.status(r.status).json(r.json);
}
