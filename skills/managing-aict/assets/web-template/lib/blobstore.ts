import { put, list, get } from "@vercel/blob";

const PREFIX = "comments/";

export interface StoredComment {
  id: string; clientId: string; author: string; shareHash: string;
  docHash: string | null;
  annotation: Record<string, unknown>; receivedAt: string;
}

export type PutCommentResult = "created" | "replay" | "conflict";

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

async function getComment(token: string, pathname: string): Promise<StoredComment | null> {
  const result = await get(pathname, { access: "private", token });
  if (result?.statusCode !== 200) return null;
  try {
    return JSON.parse(await new Response(result.stream).text()) as StoredComment;
  } catch {
    return {} as StoredComment;
  }
}

export async function putComment(
  token: string,
  comment: StoredComment,
): Promise<PutCommentResult> {
  const pathname = `${PREFIX}${comment.id}.json`;
  const existing = await getComment(token, pathname);
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
    const raced = await getComment(token, pathname);
    if (!raced) throw error;
    return sameCommentContent(raced, comment) ? "replay" : "conflict";
  }
}

export async function listComments(token: string): Promise<StoredComment[]> {
  const out: StoredComment[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ token, prefix: PREFIX, cursor, limit: 1000 });
    for (const b of page.blobs) {
      const r = await get(b.pathname, { access: "private", token });
      if (r?.statusCode === 200) {
        try { out.push(JSON.parse(await new Response(r.stream).text())); } catch { /* skip corrupt */ }
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out; // content only — blob urls never leave this module
}
