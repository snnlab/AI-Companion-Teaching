// "Feedback released" markers — the instructor clicks "학생에게 피드백 보내기"
// (Send feedback to the student) in the drilled-in board, and that flips a
// per-submission flag here. Until it is set, the student's /me page shows
// nothing at all for that submission; once set, every comment on that
// submission becomes visible there and the page surfaces a "new feedback"
// badge.
//
//   release/<shareHash>.json   { releasedAt, by }
//
// shareHash is the submission's idempotencyKey (submit.py's share_hash),
// exactly the scoping key lib/comments.ts already uses — so a release marker
// sits right beside the comments it releases. Overwrite is allowed: the
// instructor may add more comments and click "보내기" again, which just
// refreshes releasedAt (and re-triggers the student's "new" badge).
import { put, get } from "@vercel/blob";

const PREFIX = "release/";

export interface ReleaseMarker {
  releasedAt: string;
  by: string | null;
}

function releasePath(shareHash: string): string {
  return `${PREFIX}${encodeURIComponent(shareHash)}.json`;
}

export async function getRelease(
  blobToken: string,
  shareHash: string,
): Promise<ReleaseMarker | null> {
  const result = await get(releasePath(shareHash), { access: "private", token: blobToken });
  if (result?.statusCode !== 200) return null;
  try {
    return JSON.parse(await new Response(result.stream).text()) as ReleaseMarker;
  } catch {
    return null;
  }
}

export async function putRelease(
  blobToken: string,
  shareHash: string,
  by: string | null,
  now: Date = new Date(),
): Promise<ReleaseMarker> {
  const marker: ReleaseMarker = { releasedAt: now.toISOString(), by: by ?? null };
  await put(releasePath(shareHash), JSON.stringify(marker), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
    token: blobToken,
  });
  return marker;
}
