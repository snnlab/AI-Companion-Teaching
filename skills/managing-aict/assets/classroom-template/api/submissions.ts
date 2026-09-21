// POST /api/submissions — student bearer-token submission intake.
//
// Only POST is implemented here. Listing is intentionally split across two
// other routes rather than a GET on this one (documented choice — the task
// brief leaves this open): GET /api/roster gives the instructor a
// per-student SUMMARY (last submission + count + similarity flags); GET
// /api/submissions/:studentId gives one student's FULL history. Neither
// needs a plain GET /api/submissions, so it 405s.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SECURITY_HEADERS } from "../lib/gate.js";
import { validateEnvelopeShape, validateEnvelopeSize } from "../lib/validate.js";
import { resolveToken } from "../lib/roster.js";
import { putSubmission, advanceLatestPointer, indexShareHashOwner, type StoredSubmission } from "../lib/submissions.js";
import { reverifySubmission } from "../lib/reverify.js";

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
  rawBody: string,
  env: Record<string, string | undefined>,
): Promise<RunResult> {
  if (method !== "POST") return { status: 405, json: { error: "method not allowed" } };

  // Cheap, synchronous checks first — bearer header presence, body size,
  // JSON validity, envelope shape — before the async Blob-backed token
  // resolution. An oversized or malformed request is rejected without
  // spending a Blob read on it, and a request with no Authorization header
  // at all never touches storage.
  const token = bearerToken(headers);
  if (!token) return { status: 401, json: { error: "invalid_token" } };

  const sizeCheck = validateEnvelopeSize(rawBody);
  if (!sizeCheck.ok) return { status: 413, json: { error: "payload_too_large", limitBytes: sizeCheck.limitBytes } };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 400, json: { error: "malformed_envelope", detail: "body is not valid JSON" } };
  }
  const shape = validateEnvelopeShape(parsed);
  if (!shape.ok) return { status: 400, json: { error: "malformed_envelope", detail: shape.error } };
  const envelope = shape.value;

  const blobToken = env.BLOB_READ_WRITE_TOKEN as string;
  const pepper = env.ROSTER_TOKEN_PEPPER ?? "";
  const studentId = await resolveToken(blobToken, pepper, token);
  if (!studentId) return { status: 401, json: { error: "invalid_token" } };

  // Content-level issues (checksum mismatches, malformed trailers, timing
  // anomalies) are NEVER a rejection reason — only a malformed/oversized
  // ENVELOPE is (handled above). This mirrors results.py's own "advisory,
  // never blocks finalize" philosophy and AGENTS.md's "instructor role must
  // never gate a student's work" invariant.
  const reverify = reverifySubmission(envelope.payload, envelope.gitExcerpt);
  const submission: StoredSubmission = {
    studentId,
    envelopeSchemaVersion: envelope.envelopeSchemaVersion,
    submittedAt: envelope.submittedAt,
    courseId: envelope.courseId,
    idempotencyKey: envelope.idempotencyKey,
    payload: envelope.payload,
    gitExcerpt: envelope.gitExcerpt,
    serverReceivedAt: new Date().toISOString(),
    reverify,
  };

  const result = await putSubmission(blobToken, studentId, envelope.idempotencyKey, submission);

  if (result.outcome === "conflict") {
    // Not in the frozen v1 response contract (201/200/401/413/400) because
    // idempotencyKey is a client-computed CONTENT hash (submit.py's
    // share_hash) — two different contents landing on the same key should
    // never happen from a well-behaved client. This is a defensive addition
    // for the case it somehow does (a real hash collision, or a buggy/
    // malicious client), not a deviation from a contract that already
    // covered this case.
    return {
      status: 409,
      json: { error: "idempotency_conflict", detail: "this idempotencyKey is already stored with different content" },
    };
  }

  if (result.outcome === "created") {
    // A CREATED submission is, by construction, the one the student just
    // sent — advance the pointer unconditionally. A REPLAY must NOT do this:
    // it could regress "latest" backward if an older, identical-content
    // submission is retried after a newer, different submission already
    // became this student's latest. See submissions.ts's putSubmission doc.
    await advanceLatestPointer(blobToken, studentId, {
      idempotencyKey: envelope.idempotencyKey,
      submittedAt: envelope.submittedAt,
    });
    // Lets GET/POST /api/comments resolve this submission's shareHash back to
    // a studentId (see lib/submissions.ts's indexShareHashOwner) — written
    // only here, alongside the pointer advance, for the same reason: a
    // replay must never re-derive state from a submission that isn't
    // actually new.
    await indexShareHashOwner(blobToken, envelope.idempotencyKey, studentId);
    return {
      status: 201,
      json: { status: "created", submissionId: envelope.idempotencyKey, reverify: result.stored.reverify },
    };
  }

  // Replay: return the PREVIOUSLY computed reverify result, not the one just
  // recomputed above.
  return {
    status: 200,
    json: { status: "replay", submissionId: envelope.idempotencyKey, reverify: result.stored.reverify },
  };
}

// Vercel's automatic body parser would consume the raw request stream and
// hand back only a parsed object, losing the exact byte length we need for
// the 413 size check and the exact bytes we need to feed JSON.parse
// ourselves after that check (parsing before checking size would defeat the
// point of the check). Read the raw body manually instead.
export const config = { api: { bodyParser: false } };

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const rawBody = await readRawBody(req);
  const r = await run(req.method ?? "GET", req.headers as HeaderBag, rawBody, process.env);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.status(r.status).json(r.json);
}
