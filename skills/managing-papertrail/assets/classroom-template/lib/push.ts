// Web Push subscriptions + delivery. Entirely self-hosted: the only
// "third party" is the browser vendor's push service, which needs no
// account — a VAPID keypair (generated once, `npx web-push
// generate-vapid-keys`, stored as env vars) is the whole identity.
//
//   push-sub/<studentId>/<sha256(endpoint)>.json   one browser subscription
//
// A student may have several (laptop + phone); each is one blob. Dead
// endpoints (404/410 from the push service) are deleted on the next send.
import { put, list, get, del } from "@vercel/blob";
import { createHash } from "node:crypto";
import webpush from "web-push";

const PREFIX = "push-sub/";

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function readVapid(env: Record<string, string | undefined>): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  // `subject` must be a mailto: or https: URL; fall back to the deploy URL,
  // then to a placeholder mailto that push services still accept.
  const subject =
    env.VAPID_SUBJECT ||
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    "mailto:classroom@example.invalid";
  return { publicKey, privateKey, subject };
}

function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
}

function subPath(studentId: string, hash: string): string {
  return `${PREFIX}${studentId}/${hash}.json`;
}

export function isPushSubscription(v: unknown): v is PushSubscription {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  const k = s.keys as Record<string, unknown> | undefined;
  return (
    typeof s.endpoint === "string" &&
    /^https:\/\//.test(s.endpoint) &&
    s.endpoint.length <= 2048 &&
    !!k &&
    typeof k.p256dh === "string" &&
    typeof k.auth === "string"
  );
}

export async function putSub(
  blobToken: string,
  studentId: string,
  sub: PushSubscription,
): Promise<void> {
  await put(subPath(studentId, endpointHash(sub.endpoint)), JSON.stringify(sub), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
    token: blobToken,
  });
}

export async function deleteSubByEndpoint(
  blobToken: string,
  studentId: string,
  endpoint: string,
): Promise<void> {
  try {
    await del(subPath(studentId, endpointHash(endpoint)), { token: blobToken });
  } catch {
    /* already gone */
  }
}

export async function listSubs(
  blobToken: string,
  studentId: string,
): Promise<PushSubscription[]> {
  const out: PushSubscription[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ token: blobToken, prefix: `${PREFIX}${studentId}/`, cursor, limit: 1000 });
    for (const b of page.blobs) {
      const r = await get(b.pathname, { access: "private", token: blobToken });
      if (r?.statusCode === 200) {
        try {
          const parsed = JSON.parse(await new Response(r.stream).text());
          if (isPushSubscription(parsed)) out.push(parsed);
        } catch {
          /* skip corrupt */
        }
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export interface PushResult { sent: number; pruned: number }

/** Send `payload` to every subscription; delete any the push service
 * reports as gone. Never throws — a notification failure must not fail the
 * release it rides on. */
export async function sendToStudent(
  blobToken: string,
  studentId: string,
  vapid: VapidConfig,
  payload: { title: string; body: string; url: string },
  deps: {
    listSubs: typeof listSubs;
    deleteSubByEndpoint: typeof deleteSubByEndpoint;
    send: (sub: PushSubscription, body: string, vapid: VapidConfig) => Promise<number>;
  } = { listSubs, deleteSubByEndpoint, send: sendOne },
): Promise<PushResult> {
  let sent = 0;
  let pruned = 0;
  const subs = await deps.listSubs(blobToken, studentId);
  const body = JSON.stringify(payload);
  for (const sub of subs) {
    try {
      const status = await deps.send(sub, body, vapid);
      if (status === 404 || status === 410) {
        await deps.deleteSubByEndpoint(blobToken, studentId, sub.endpoint);
        pruned++;
      } else {
        sent++;
      }
    } catch (e) {
      const status = (e as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await deps.deleteSubByEndpoint(blobToken, studentId, sub.endpoint);
        pruned++;
      }
      // any other error: swallow, this is best-effort
    }
  }
  return { sent, pruned };
}

async function sendOne(
  sub: PushSubscription,
  body: string,
  vapid: VapidConfig,
): Promise<number> {
  const res = await webpush.sendNotification(
    { endpoint: sub.endpoint, keys: sub.keys },
    body,
    {
      vapidDetails: {
        subject: vapid.subject,
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
      TTL: 24 * 3600,
    },
  );
  return res.statusCode;
}
