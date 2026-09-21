// Content-addressed, immutable submission storage.
//
//   submissions/<studentId>/<idempotencyKey>.json   the full envelope + serverReceivedAt + reverify
//   submissions/<studentId>/_latest.json            overwritable pointer {idempotencyKey, submittedAt}
//
// Staging-less by design: the key IS the idempotencyKey (submit.py's
// share_hash, a content hash), so two different contents simply land at two
// different keys — there is no in-place mutation to protect against the way
// blobstore.ts's putComment protects a fixed comment id. The immutable
// content record is always written FIRST; the movable pointer is advanced
// only after that resolves — the same "immutable record, then a movable
// pointer" shape as results.py's stage-then-atomic-rename, adapted to a
// content-addressed store (there is no rename here, just a pointer flip).
import { put, get, list } from "@vercel/blob";
import type { ReverifyCheck } from "./reverify.js";
import type { GitExcerpt } from "./validate.js";

const SUBMISSIONS_PREFIX = "submissions/";
const SHAREHASH_INDEX_PREFIX = "submission-index/";

export interface StoredSubmission {
  studentId: string;
  envelopeSchemaVersion: number;
  submittedAt: string;
  courseId: string | null;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  gitExcerpt: GitExcerpt;
  serverReceivedAt: string;
  reverify: ReverifyCheck[];
}

export interface LatestPointer {
  idempotencyKey: string;
  submittedAt: string;
}

function submissionPath(studentId: string, key: string): string {
  return `${SUBMISSIONS_PREFIX}${studentId}/${key}.json`;
}
function latestPointerPath(studentId: string): string {
  return `${SUBMISSIONS_PREFIX}${studentId}/_latest.json`;
}
function shareHashIndexPath(key: string): string {
  return `${SHAREHASH_INDEX_PREFIX}${key}.json`;
}

async function readJsonBlob<T>(blobToken: string, pathname: string): Promise<T | null> {
  const result = await get(pathname, { access: "private", token: blobToken });
  if (result?.statusCode !== 200) return null;
  try {
    return JSON.parse(await new Response(result.stream).text()) as T;
  } catch {
    return null;
  }
}

// Same canonical-JSON content comparison shape as web-template's
// blobstore.ts putComment — sorted keys so field order never causes a false
// "conflict".
function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, normalize(item)]),
      );
    }
    return v;
  };
  return JSON.stringify(normalize(value));
}

// A submission is IDENTIFIED by its graded content. The `idempotencyKey` is
// submit.py's `share_hash` — a sha256 over master-plan + decision-log +
// every plan version + draft snapshots + results bundles + reviews +
// history + archives, i.e. exactly `payload.files`. Everything else in the
// stored record is send-context that a well-behaved client legitimately
// varies between two sends of the same work, and MUST NOT turn a plain
// resend into a `conflict`:
//   - `serverReceivedAt` / `reverify` — server-added; `reverify` is
//     recomputed on every POST and a replay returns the STORED result.
//   - `submittedAt` / `payload.generatedAt` — wall clock at send time.
//   - `gitExcerpt` / `payload.git` — the commit log / HEAD / per-file
//     commit dates at send time; any commit (even outside `plans/`) moves
//     HEAD. A plan file that actually changed already changes the
//     `idempotencyKey` (and thus the storage key), so a same-key resend
//     means the graded files are byte-identical.
//   - `payload.mode` / `focus` / `schemaVersion` / `detailLevel` /
//     `modelProfile` / `project` — not covered by the content hash.
// So the comparison is exactly the hash's domain, plus `courseId` (which is
// identifying but not in the hash). This keeps `conflict` reachable only by
// a genuine sha256 collision or a client that fakes the key — the case the
// 409 branch in api/submissions.ts was actually added for.
function sameSubmissionContent(a: StoredSubmission, b: StoredSubmission): boolean {
  const identity = (s: StoredSubmission) => ({
    courseId: s.courseId,
    idempotencyKey: s.idempotencyKey,
    files: (s.payload as { files?: unknown })?.files ?? null,
  });
  return canonicalJson(identity(a)) === canonicalJson(identity(b));
}

export type PutSubmissionResult =
  | { outcome: "created"; stored: StoredSubmission }
  | { outcome: "replay"; stored: StoredSubmission }
  | { outcome: "conflict"; stored: StoredSubmission };

export async function putSubmission(
  blobToken: string,
  studentId: string,
  key: string,
  submission: StoredSubmission,
): Promise<PutSubmissionResult> {
  const pathname = submissionPath(studentId, key);
  const existing = await readJsonBlob<StoredSubmission>(blobToken, pathname);
  if (existing) {
    return { outcome: sameSubmissionContent(existing, submission) ? "replay" : "conflict", stored: existing };
  }
  try {
    await put(pathname, JSON.stringify(submission), {
      access: "private", allowOverwrite: false, contentType: "application/json", token: blobToken,
    });
    return { outcome: "created", stored: submission };
  } catch (error) {
    // Another request may have won the create-only race. Read the winner
    // and classify it by content, exactly as blobstore.ts's putComment does.
    const raced = await readJsonBlob<StoredSubmission>(blobToken, pathname);
    if (!raced) throw error;
    return { outcome: sameSubmissionContent(raced, submission) ? "replay" : "conflict", stored: raced };
  }
}

export async function advanceLatestPointer(
  blobToken: string,
  studentId: string,
  pointer: LatestPointer,
): Promise<void> {
  await put(latestPointerPath(studentId), JSON.stringify(pointer), {
    access: "private", allowOverwrite: true, contentType: "application/json", token: blobToken,
  });
}

export async function getLatestPointer(blobToken: string, studentId: string): Promise<LatestPointer | null> {
  return readJsonBlob<LatestPointer>(blobToken, latestPointerPath(studentId));
}

// A submission's idempotencyKey doubles as its payload's shareHash (both are
// submit.py's share_hash over the same payload — see submit.py's
// build_envelope). This index lets GET/POST /api/comments resolve "which
// student does this shareHash belong to" in one Blob get() — the same
// one-lookup shape as lib/roster.ts's token->studentId reverse index —
// instead of scanning every student's submissions. Written only on a
// CREATED submission (never on replay/conflict), mirroring
// advanceLatestPointer's own call-site guard in api/submissions.ts.
export async function indexShareHashOwner(
  blobToken: string,
  shareHash: string,
  studentId: string,
): Promise<void> {
  await put(shareHashIndexPath(shareHash), JSON.stringify({ studentId }), {
    access: "private", allowOverwrite: true, contentType: "application/json", token: blobToken,
  });
}

export async function resolveShareHashOwner(
  blobToken: string,
  shareHash: string,
): Promise<string | null> {
  const indexed = await readJsonBlob<{ studentId: string }>(blobToken, shareHashIndexPath(shareHash));
  return indexed?.studentId ?? null;
}

export async function getSubmission(
  blobToken: string,
  studentId: string,
  key: string,
): Promise<StoredSubmission | null> {
  return readJsonBlob<StoredSubmission>(blobToken, submissionPath(studentId, key));
}

// All of a student's submissions, newest-first by submittedAt. Used by
// GET /api/submissions/:studentId (full history). Small per-course volumes
// are expected, so this is a plain list()+get() sweep with no extra index —
// documented simplification, not a scalability guarantee.
export async function listSubmissionsForStudent(
  blobToken: string,
  studentId: string,
): Promise<StoredSubmission[]> {
  const prefix = `${SUBMISSIONS_PREFIX}${studentId}/`;
  const out: StoredSubmission[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ token: blobToken, prefix, cursor, limit: 1000 });
    for (const b of page.blobs) {
      if (b.pathname.endsWith("/_latest.json")) continue;
      const sub = await readJsonBlob<StoredSubmission>(blobToken, b.pathname);
      if (sub) out.push(sub);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  out.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : a.submittedAt > b.submittedAt ? -1 : 0));
  return out;
}
