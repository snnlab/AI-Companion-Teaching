// Instructor comments left while drilling into one student's board from the
// roster dashboard. Storage is scoped by shareHash (== the submission's
// idempotencyKey, since both are submit.py's share_hash over the same
// payload) rather than by studentId directly, because that is exactly the
// field the board's existing comment-posting code already sends (see
// board/src/lib/hostedComments.ts's buildCommentBody) — reusing it here
// means the client needs no new field, only the one-line query-param change
// described in App.tsx.
//
//   comments/<shareHash>/<id>.json   one comment, content-addressed by its
//                                    own uuid within the shareHash "folder"
//
// Creation is create-only (putComment). The instructor may later change a
// comment's text (updateComment — stamps editedAt, never touches the anchor)
// or delete it (deleteComment); students see either on their next read.
//
// Mirrors web-template/lib/blobstore.ts's putComment/listComments shape and
// create/replay/conflict idempotency — duplicated, not imported, same as
// lib/validate.ts's validateCommentBody above.
import { put, list, get, del } from "@vercel/blob";

const PREFIX = "comments/";

export interface StoredComment {
  id: string; clientId: string; author: string; shareHash: string;
  docHash: string | null;
  annotation: Record<string, unknown>; receivedAt: string;
  // Set when the instructor edits the comment text after creation.
  editedAt?: string;
}

export type PutCommentResult = "created" | "replay" | "conflict";

function commentPath(shareHash: string, id: string): string {
  return `${PREFIX}${encodeURIComponent(shareHash)}/${id}.json`;
}

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

function sameCommentContent(a: StoredComment, b: StoredComment): boolean {
  const { receivedAt: _aReceivedAt, ...aContent } = a;
  const { receivedAt: _bReceivedAt, ...bContent } = b;
  return canonicalJson(aContent) === canonicalJson(bContent);
}

export async function getComment(token: string, shareHash: string, id: string): Promise<StoredComment | null> {
  const result = await get(commentPath(shareHash, id), { access: "private", token });
  if (result?.statusCode !== 200) return null;
  try {
    return JSON.parse(await new Response(result.stream).text()) as StoredComment;
  } catch {
    return null;
  }
}

export async function putComment(
  token: string,
  comment: StoredComment,
): Promise<PutCommentResult> {
  const pathname = commentPath(comment.shareHash, comment.id);
  const existing = await getComment(token, comment.shareHash, comment.id);
  if (existing) return sameCommentContent(existing, comment) ? "replay" : "conflict";

  try {
    await put(pathname, JSON.stringify(comment), {
      access: "private",
      allowOverwrite: false,
      contentType: "application/json",
      token,
    });
    return "created";
  } catch (error) {
    // Another request may have won the create-only race. Read the winner and
    // classify it by content. Unrelated storage errors still propagate.
    const raced = await getComment(token, comment.shareHash, comment.id);
    if (!raced) throw error;
    return sameCommentContent(raced, comment) ? "replay" : "conflict";
  }
}

export async function listCommentsForShareHash(token: string, shareHash: string): Promise<StoredComment[]> {
  const prefix = `${PREFIX}${encodeURIComponent(shareHash)}/`;
  const out: StoredComment[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ token, prefix, cursor, limit: 1000 });
    for (const b of page.blobs) {
      const r = await get(b.pathname, { access: "private", token });
      if (r?.statusCode === 200) {
        try { out.push(JSON.parse(await new Response(r.stream).text())); } catch { /* skip corrupt */ }
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export interface CommentPatch {
  comment: string;
  // null clears the integrity flag; undefined leaves it as it was.
  category?: "integrity" | null;
}

/** Rewrite one comment's text in place. Returns the updated comment, or null
 * when it does not exist. Anchor fields, id and receivedAt are kept. */
export async function updateComment(
  token: string,
  shareHash: string,
  id: string,
  patch: CommentPatch,
  now: string,
): Promise<StoredComment | null> {
  const existing = await getComment(token, shareHash, id);
  if (!existing) return null;
  const annotation: Record<string, unknown> = { ...existing.annotation, comment: patch.comment };
  if (patch.category === null) delete annotation.category;
  else if (patch.category !== undefined) annotation.category = patch.category;
  const updated: StoredComment = { ...existing, annotation, editedAt: now };
  await put(commentPath(shareHash, id), JSON.stringify(updated), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });
  return updated;
}

/** Delete one comment. Deleting one that is already gone is not an error. */
export async function deleteComment(token: string, shareHash: string, id: string): Promise<void> {
  await del(commentPath(shareHash, id), { token });
}
