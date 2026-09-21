// GET /api/vapid-public-key — the VAPID *public* key, for the /me page's
// pushManager.subscribe() call. Public by definition (it is the "application
// server key" browsers embed in the subscription); no auth, and no secret
// here. Returns { key: null } when web push is not configured on this
// deployment so the page can hide its "알림 받기" button.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SECURITY_HEADERS } from "../lib/gate.js";

export interface RunResult { status: number; json: unknown }

export function run(method: string, env: Record<string, string | undefined>): RunResult {
  if (method !== "GET") return { status: 405, json: { error: "method not allowed" } };
  return { status: 200, json: { key: env.VAPID_PUBLIC_KEY ?? null } };
}

export default function handler(req: VercelRequest, res: VercelResponse): void {
  const r = run(req.method ?? "GET", process.env);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.status(r.status).json(r.json);
}
