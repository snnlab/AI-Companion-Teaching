// Student registration, token minting/hashing, and the token->studentId
// reverse index. Storage is Vercel Blob only (this repo has no KV/database
// dependency anywhere; keep it that way):
//
//   roster/<studentId>.json             {studentId, displayName, tokenHash, createdAt}
//   roster-token-index/<sha256(...)>.json  {studentId}
//
// The plaintext token is NEVER stored anywhere — only sha256(pepper+token).
// It is returned exactly once, in the POST /api/roster response body.
import { put, get, list, del } from "@vercel/blob";
import { createHash, randomBytes } from "node:crypto";
import { timingSafeEqualStr } from "./auth.js";

const ROSTER_PREFIX = "roster/";
const TOKEN_INDEX_PREFIX = "roster-token-index/";
const LAST_VIEWED_PATH = "roster-meta/last-viewed.json";

export const STUDENT_ID_RE = /^[a-zA-Z0-9._-]{1,100}$/;

export interface RosterEntry {
  studentId: string;
  displayName: string;
  tokenHash: string;
  createdAt: string;
}

function rosterPath(studentId: string): string {
  return `${ROSTER_PREFIX}${studentId}.json`;
}
function tokenIndexPath(tokenHash: string): string {
  return `${TOKEN_INDEX_PREFIX}${tokenHash}.json`;
}

// sha256(pepper + token) hex. Peppered so a leaked Blob snapshot alone can't
// be brute-forced offline against the token space without the pepper too (a
// separate Vercel env secret, ROSTER_TOKEN_PEPPER, never stored in Blob) —
// defense in depth on top of the token's own high entropy.
export function hashToken(token: string, pepper: string): string {
  return createHash("sha256").update(pepper + token).digest("hex");
}

// 32 random bytes, base64url-encoded (~43 chars, 256 bits of entropy). A
// bearer credential minted per student needs far more entropy than
// board.py's generate_passphrase() (~20-bit diceware) — that scheme is fine
// for the ONE shared passphrase a human reads aloud once, not for a
// machine-to-machine secret submit.py sends over the wire on every run.
export function mintToken(): string {
  return randomBytes(32).toString("base64url");
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

export async function getStudent(blobToken: string, studentId: string): Promise<RosterEntry | null> {
  return readJsonBlob<RosterEntry>(blobToken, rosterPath(studentId));
}

export async function listRoster(blobToken: string): Promise<RosterEntry[]> {
  const out: RosterEntry[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ token: blobToken, prefix: ROSTER_PREFIX, cursor, limit: 1000 });
    for (const b of page.blobs) {
      const entry = await readJsonBlob<RosterEntry>(blobToken, b.pathname);
      if (entry) out.push(entry);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

// Registers a new student OR rotates an existing one's token (upsert). The
// plan's own endpoint list has only ONE mutation route — POST /api/roster —
// covering both "register a new student" and "mint a fresh token"; there is
// no separate rotate endpoint. host.md's --rotate-token therefore just POSTs
// the student's existing displayName again (see rotateToken below, a thin
// convenience wrapper for that CLI path).
export async function upsertStudent(
  blobToken: string,
  pepper: string,
  studentId: string,
  displayName: string,
): Promise<{ token: string; entry: RosterEntry; rotated: boolean }> {
  const existing = await getStudent(blobToken, studentId);
  const token = mintToken();
  const tokenHash = hashToken(token, pepper);
  const entry: RosterEntry = {
    studentId,
    displayName,
    tokenHash,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  // Roster entries ARE mutable (unlike the content-addressed submission
  // store) — allowOverwrite is intentional here.
  await put(rosterPath(studentId), JSON.stringify(entry), {
    access: "private", allowOverwrite: true, contentType: "application/json", token: blobToken,
  });
  await put(tokenIndexPath(tokenHash), JSON.stringify({ studentId }), {
    access: "private", allowOverwrite: true, contentType: "application/json", token: blobToken,
  });
  if (existing && existing.tokenHash !== tokenHash) {
    // Invalidate the previous token immediately: a POST /api/submissions
    // bearer lookup against the OLD token must resolve to nothing after
    // this. Best-effort — if the delete races or fails, the roster entry's
    // own tokenHash has already moved on, and resolveToken's second-step
    // re-confirmation against the roster entry (see below) still refuses
    // a stale index hit.
    await del(tokenIndexPath(existing.tokenHash), { token: blobToken }).catch(() => {});
  }
  return { token, entry, rotated: existing !== null };
}

// Convenience wrapper for --rotate-token, which only has a studentId to
// work with (no displayName) — reuses the existing one.
export async function rotateToken(
  blobToken: string,
  pepper: string,
  studentId: string,
): Promise<{ token: string; entry: RosterEntry } | null> {
  const existing = await getStudent(blobToken, studentId);
  if (!existing) return null;
  const { token, entry } = await upsertStudent(blobToken, pepper, studentId, existing.displayName);
  return { token, entry };
}

// "New since I last opened the dashboard." There is only one instructor
// login this round (the shared BOARD_PASSWORD), so a single pointer is
// enough — no per-instructor state to key it by. GET /api/roster reads the
// PREVIOUS value to compute each row's isNewSinceLastView (see api/roster.ts),
// then overwrites it with `now` — the same "read-before-overwrite" shape as
// board.py's own hosted-comment pull-clears-on-read behavior, just for
// submissions instead of comments.
export async function getLastViewed(blobToken: string): Promise<string | null> {
  const doc = await readJsonBlob<{ timestamp: string }>(blobToken, LAST_VIEWED_PATH);
  return doc?.timestamp ?? null;
}

export async function setLastViewed(blobToken: string, timestamp: string): Promise<void> {
  await put(LAST_VIEWED_PATH, JSON.stringify({ timestamp }), {
    access: "private", allowOverwrite: true, contentType: "application/json", token: blobToken,
  });
}

// Resolves a plaintext bearer token to a studentId via the reverse index —
// one Blob get() keyed by sha256(pepper+token), never a full roster scan.
export async function resolveToken(blobToken: string, pepper: string, token: string): Promise<string | null> {
  const tokenHash = hashToken(token, pepper);
  const indexed = await readJsonBlob<{ studentId: string }>(blobToken, tokenIndexPath(tokenHash));
  if (!indexed?.studentId) return null;
  // Defense in depth: don't trust the reverse-index hit alone (e.g. a stale
  // index entry left over from a race during upsertStudent's rotation).
  // Re-fetch the roster entry for the resolved id and re-confirm the hash
  // with the SAME constant-time comparison api/login.ts uses for the
  // instructor password. A mismatch means the index and roster disagree —
  // refuse rather than trust either alone.
  const entry = await getStudent(blobToken, indexed.studentId);
  if (!entry || !timingSafeEqualStr(entry.tokenHash, tokenHash)) return null;
  return indexed.studentId;
}
