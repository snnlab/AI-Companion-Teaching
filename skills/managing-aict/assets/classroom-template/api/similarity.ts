// POST /api/similarity — instructor-triggered, all-pairs comparison over
// every student's latest submission's decision-log text. Never run
// automatically per submission (O(N^2), and the design plan is explicit
// that this stays a manual, instructor-initiated action). Caches its result
// to similarity/latest.json.
// GET  /api/similarity — reads the cached result without recomputing (the
// documented choice for "whichever GET route makes sense" — a dedicated
// route here, in addition to GET /api/roster surfacing each student's own
// flags inline, so the instructor can see "last checked at" and the full
// flag list in one place without walking the whole roster).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthed, type HeaderBag } from "../lib/auth.js";
import { SECURITY_HEADERS } from "../lib/gate.js";
import { listRoster } from "../lib/roster.js";
import { getLatestPointer, getSubmission } from "../lib/submissions.js";
import { compareStudents, writeSimilarityCache, readSimilarityCache } from "../lib/similarity.js";
import { isRecord, str } from "../lib/reverify.js";

export interface RunResult { status: number; json: unknown }

export async function run(
  method: string,
  headers: HeaderBag,
  env: Record<string, string | undefined>,
  now: number,
): Promise<RunResult> {
  if (!isAuthed({ BOARD_SESSION_SECRET: env.BOARD_SESSION_SECRET }, headers, now)) {
    return { status: 401, json: { error: "unauthorized" } };
  }
  const blobToken = env.BLOB_READ_WRITE_TOKEN as string;

  if (method === "GET") {
    const cache = await readSimilarityCache(blobToken);
    return { status: 200, json: cache ?? { checkedAt: null, flags: [] } };
  }

  if (method !== "POST") return { status: 405, json: { error: "method not allowed" } };

  const roster = await listRoster(blobToken);
  const inputs: { studentId: string; decisionLogText: string }[] = [];
  for (const entry of roster) {
    const pointer = await getLatestPointer(blobToken, entry.studentId);
    if (!pointer) continue;
    const sub = await getSubmission(blobToken, entry.studentId, pointer.idempotencyKey);
    if (!sub) continue;
    const files = isRecord(sub.payload) && isRecord(sub.payload.files) ? sub.payload.files : {};
    const decisionLog = isRecord(files.decisionLog) ? str(files.decisionLog.content) ?? "" : "";
    inputs.push({ studentId: entry.studentId, decisionLogText: decisionLog });
  }

  const flags = compareStudents(inputs);
  const result = { checkedAt: new Date().toISOString(), flags };
  await writeSimilarityCache(blobToken, result);
  return { status: 200, json: result };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const r = await run(req.method ?? "GET", req.headers as HeaderBag, process.env, Math.floor(Date.now() / 1000));
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.status(r.status).json(r.json);
}
