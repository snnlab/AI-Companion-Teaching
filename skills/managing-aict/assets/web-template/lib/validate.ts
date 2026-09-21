export const MAX_COMMENT_LEN = 4000;
export const MAX_FIELD_LEN = 2000;
export const MAX_AUTHOR_LEN = 120;
// Per-field caps sum to ~15KB content; JSON overhead + extra fields push legitimate comments
// to ~18–20KB. Set at 64KB (well above max legitimate, still bounding DoS/blob-write risk).
export const MAX_TOTAL_BYTES = 65536;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_TYPES = new Set([
  "plan-comment", "result-comment", "script-comment", "doc-comment", "general",
]);

export interface CommentBody {
  id: string; clientId: string; author: string; shareHash: string;
  docHash: string | null;
  annotation: Record<string, unknown> & { type: string };
}

function isStr(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length <= max;
}

export function validateCommentBody(
  body: unknown,
): { ok: true; value: CommentBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "not an object" };
  let serialized: string;
  try { serialized = JSON.stringify(body); }
  catch { return { ok: false, error: "unserializable" }; }
  if (Buffer.byteLength(serialized, "utf8") > MAX_TOTAL_BYTES) {
    return { ok: false, error: "too large" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.id !== "string" || !UUID_RE.test(b.id)) return { ok: false, error: "bad id" };
  if (!isStr(b.clientId, 200)) return { ok: false, error: "bad clientId" };
  if (!isStr(b.author, MAX_AUTHOR_LEN)) return { ok: false, error: "bad author" };
  if (!isStr(b.shareHash, 200)) return { ok: false, error: "bad shareHash" };
  if ("docHash" in b && b.docHash !== null && !isStr(b.docHash, 200)) return { ok: false, error: "bad docHash" };
  const a = b.annotation as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object") return { ok: false, error: "missing annotation" };
  if (typeof a.type !== "string" || !ALLOWED_TYPES.has(a.type)) {
    return { ok: false, error: "disallowed type" };
  }
  if ("comment" in a && !isStr(a.comment, MAX_COMMENT_LEN)) return { ok: false, error: "comment too long" };
  for (const k of ["quote", "excerpt", "sectionHeading", "component", "script"]) {
    if (k in a && !isStr(a[k], MAX_FIELD_LEN)) return { ok: false, error: `${k} too long` };
  }
  return { ok: true, value: b as unknown as CommentBody };
}
