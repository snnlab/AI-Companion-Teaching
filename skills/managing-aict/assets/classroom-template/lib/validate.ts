// Envelope shape/size validation for POST /api/submissions. This validates
// only the ENVELOPE (the wire wrapper submit.py sends) — `payload` itself is
// a BoardData-shaped object owned by board/src/lib/types.ts and is treated
// as opaque pass-through data here, exactly as the task brief for this
// template specifies: never re-validated against that schema strictly,
// only read from selectively by lib/reverify.ts.

// Vercel's default serverless function body limit. Requests over this are
// rejected with 413 before we even try to parse JSON.
export const MAX_ENVELOPE_BYTES = 4718592; // 4.5 * 1024 * 1024

export const IDEMPOTENCY_KEY_RE = /^[0-9a-f]{16}$/;

// Per-commit git-log excerpt entry. `files` is OPTIONAL and NOT part of the
// frozen v1 envelope contract shared with submit.py (git_log_excerpt() only
// promises hash/authorDate/authorName/subject — see the plan's own
// description of that function). It is accepted here, forward-compatibly,
// so that if a future submit.py starts attaching per-commit touched paths,
// lib/reverify.ts's git-timing check automatically upgrades from its
// subject-line heuristic to exact per-file matching with no wire-contract
// change required. See lib/reverify.ts's commitsTouchingPath for the
// fallback this enables.
export interface GitExcerptCommit {
  hash: string;
  authorDate: string;
  authorName: string | null;
  subject: string;
  files?: string[];
}

export interface GitExcerpt {
  available: boolean;
  head: string | null;
  branch: string | null;
  commits: GitExcerptCommit[];
}

export interface SubmissionEnvelope {
  envelopeSchemaVersion: number;
  submittedAt: string;
  courseId: string | null;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  gitExcerpt: GitExcerpt;
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

// ---- Comment body validation (POST /api/comments) — ported from
// web-template/lib/validate.ts's validateCommentBody. Duplicated rather than
// imported: the two templates are deployed independently (see the classroom
// server's own design note about copying, not cross-importing, from
// web-template), and this is the same accepted-duplication pattern already
// used for lib/auth.ts's HMAC-cookie primitives. Keep the two in lockstep by
// hand if the wire contract ever changes. ----

export const MAX_COMMENT_LEN = 4000;
export const MAX_COMMENT_FIELD_LEN = 2000;
export const MAX_COMMENT_AUTHOR_LEN = 120;
// Per-field caps sum to ~15KB content; JSON overhead + extra fields push
// legitimate comments to ~18-20KB. Set at 64KB (well above max legitimate,
// still bounding DoS/blob-write risk) — same bound web-template uses.
export const MAX_COMMENT_TOTAL_BYTES = 65536;
const COMMENT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ANNOTATION_TYPES = new Set([
  "plan-comment", "result-comment", "script-comment", "doc-comment", "general",
]);

export interface CommentBody {
  id: string; clientId: string; author: string; shareHash: string;
  docHash: string | null;
  annotation: Record<string, unknown> & { type: string };
}

function isStrMax(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length <= max;
}

export function validateCommentBody(
  body: unknown,
): { ok: true; value: CommentBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "not an object" };
  let serialized: string;
  try { serialized = JSON.stringify(body); }
  catch { return { ok: false, error: "unserializable" }; }
  if (Buffer.byteLength(serialized, "utf8") > MAX_COMMENT_TOTAL_BYTES) {
    return { ok: false, error: "too large" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.id !== "string" || !COMMENT_UUID_RE.test(b.id)) return { ok: false, error: "bad id" };
  if (!isStrMax(b.clientId, 200)) return { ok: false, error: "bad clientId" };
  if (!isStrMax(b.author, MAX_COMMENT_AUTHOR_LEN)) return { ok: false, error: "bad author" };
  if (!isStrMax(b.shareHash, 200)) return { ok: false, error: "bad shareHash" };
  if ("docHash" in b && b.docHash !== null && !isStrMax(b.docHash, 200)) return { ok: false, error: "bad docHash" };
  const a = b.annotation as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object") return { ok: false, error: "missing annotation" };
  if (typeof a.type !== "string" || !ALLOWED_ANNOTATION_TYPES.has(a.type)) {
    return { ok: false, error: "disallowed type" };
  }
  if ("comment" in a && !isStrMax(a.comment, MAX_COMMENT_LEN)) return { ok: false, error: "comment too long" };
  for (const k of ["quote", "excerpt", "sectionHeading", "component", "script"]) {
    if (k in a && !isStrMax(a[k], MAX_COMMENT_FIELD_LEN)) return { ok: false, error: `${k} too long` };
  }
  return { ok: true, value: b as unknown as CommentBody };
}

function isIsoDate(v: unknown): v is string {
  return isStr(v) && v.length > 0 && !Number.isNaN(Date.parse(v));
}

export function validateEnvelopeSize(raw: string): { ok: true } | { ok: false; limitBytes: number } {
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes > MAX_ENVELOPE_BYTES) return { ok: false, limitBytes: MAX_ENVELOPE_BYTES };
  return { ok: true };
}

export function validateEnvelopeShape(
  body: unknown,
): { ok: true; value: SubmissionEnvelope } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "envelope is not an object" };
  }
  const b = body as Record<string, unknown>;
  if (b.envelopeSchemaVersion !== 1) return { ok: false, error: "unsupported envelopeSchemaVersion" };
  if (!isIsoDate(b.submittedAt)) return { ok: false, error: "submittedAt is not a valid ISO8601 date" };
  if (b.courseId !== null && !isStr(b.courseId)) return { ok: false, error: "courseId must be a string or null" };
  if (!isStr(b.idempotencyKey) || !IDEMPOTENCY_KEY_RE.test(b.idempotencyKey)) {
    return { ok: false, error: "idempotencyKey must be a 16-character lowercase hex string" };
  }
  if (typeof b.payload !== "object" || b.payload === null || Array.isArray(b.payload)) {
    return { ok: false, error: "payload must be an object" };
  }
  const g = b.gitExcerpt;
  if (typeof g !== "object" || g === null || Array.isArray(g)) {
    return { ok: false, error: "gitExcerpt must be an object" };
  }
  const ge = g as Record<string, unknown>;
  if (typeof ge.available !== "boolean") return { ok: false, error: "gitExcerpt.available must be a boolean" };
  if (ge.head !== null && !isStr(ge.head)) return { ok: false, error: "gitExcerpt.head must be a string or null" };
  if (ge.branch !== null && !isStr(ge.branch)) return { ok: false, error: "gitExcerpt.branch must be a string or null" };
  if (!Array.isArray(ge.commits)) return { ok: false, error: "gitExcerpt.commits must be an array" };
  for (const c of ge.commits) {
    if (typeof c !== "object" || c === null || Array.isArray(c)) {
      return { ok: false, error: "gitExcerpt.commits entries must be objects" };
    }
    const cc = c as Record<string, unknown>;
    if (!isStr(cc.hash)) return { ok: false, error: "commit.hash must be a string" };
    if (!isIsoDate(cc.authorDate)) return { ok: false, error: "commit.authorDate must be a valid ISO8601 date" };
    if (cc.authorName !== null && !isStr(cc.authorName)) {
      return { ok: false, error: "commit.authorName must be a string or null" };
    }
    if (!isStr(cc.subject)) return { ok: false, error: "commit.subject must be a string" };
    if (cc.files !== undefined && !(Array.isArray(cc.files) && cc.files.every(isStr))) {
      return { ok: false, error: "commit.files, if present, must be an array of strings" };
    }
  }
  return {
    ok: true,
    value: {
      envelopeSchemaVersion: 1,
      submittedAt: b.submittedAt as string,
      courseId: (b.courseId as string | null) ?? null,
      idempotencyKey: b.idempotencyKey as string,
      payload: b.payload as Record<string, unknown>,
      gitExcerpt: {
        available: ge.available as boolean,
        head: (ge.head as string | null) ?? null,
        branch: (ge.branch as string | null) ?? null,
        commits: ge.commits as GitExcerptCommit[],
      },
    },
  };
}
