import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearCookieHeader } from "../lib/auth.js";
import { SECURITY_HEADERS } from "../lib/gate.js";

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  // Intentionally method-agnostic: no board code calls this endpoint.
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.setHeader("Set-Cookie", clearCookieHeader());
  res.status(200).json({ ok: true });
}
