// Content-addressed storage for files a submission carries OUTSIDE its JSON
// envelope — manuscript figures and results-bundle artifacts.
//
//   assets/<studentId>/<sha256>/<part>     raw bytes, part 0..parts-1
//
// Why this exists: a Vercel Function's request AND response bodies are each
// capped at 4.5 MB, so a submission that inlined every figure as a base64
// data URI hit that ceiling (and, worse, the drill-in response that returned
// every submission at once could exceed it even when each submit fit).
// submit.py now uploads each file here first, in parts of at most
// ASSET_PART_BYTES, and the envelope references it as `aict-asset:<sha256>`
// with its metadata in payload.externalAssets.
//
// Trust: a part is stored only after the server hashes the bytes it actually
// received — a single-part asset against its full sha256, a part of a
// multi-part asset against the per-part hash the client declares. A
// multi-part asset's WHOLE hash is verified when a submission first
// references it (verifyAsset). So an `aict-asset:<sha>` reference inside an
// accepted submission is as trustworthy as the inline bytes it replaced, and
// reverify can use the sha directly as the file's recomputed checksum.
//
// Scoped per student: one student can never read or overwrite another's
// files, even if they learn a hash.
import { createHash } from "node:crypto";
import { put, get, head } from "@vercel/blob";

export const ASSET_PART_BYTES = 4 * 1024 * 1024;
export const MAX_ASSET_PARTS = 64; // 256 MB per file — far above any figure
export const SHA256_RE = /^[0-9a-f]{64}$/;
export const ASSET_REF_PREFIX = "aict-asset:";

export interface ExternalAssetMeta {
  mime: string;
  size: number;
  parts: number;
}

export function assetPartPath(studentId: string, sha: string, part: number): string {
  return `assets/${studentId}/${sha}/${part}`;
}

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export async function putAssetPart(
  blobToken: string,
  studentId: string,
  sha: string,
  part: number,
  bytes: Buffer,
): Promise<void> {
  // Content-addressed: the same path always holds the same bytes, so an
  // overwrite (a retried upload) is harmless.
  await put(assetPartPath(studentId, sha, part), bytes, {
    access: "private",
    allowOverwrite: true,
    contentType: "application/octet-stream",
    token: blobToken,
  });
}

export async function hasAssetPart(
  blobToken: string,
  studentId: string,
  sha: string,
  part: number,
): Promise<boolean> {
  try {
    await head(assetPartPath(studentId, sha, part), { token: blobToken });
    return true;
  } catch {
    return false;
  }
}

export async function hasAsset(
  blobToken: string,
  studentId: string,
  sha: string,
  parts: number,
): Promise<boolean> {
  const present = await Promise.all(
    Array.from({ length: parts }, (_, i) => hasAssetPart(blobToken, studentId, sha, i)),
  );
  return present.every(Boolean);
}

export async function readAssetPart(
  blobToken: string,
  studentId: string,
  sha: string,
  part: number,
): Promise<Buffer | null> {
  const result = await get(assetPartPath(studentId, sha, part), { access: "private", token: blobToken });
  if (result?.statusCode !== 200) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

function verifiedMarkerPath(studentId: string, sha: string): string {
  return `assets/${studentId}/${sha}/verified`;
}

// Whole-file check for a multi-part asset: every part present and the
// concatenation hashes to `sha`. Done once — a marker then stands in for it,
// so a resubmission does not download the whole file again. A single-part
// asset was already verified against `sha` at upload, so presence is enough.
export async function verifyAsset(
  blobToken: string,
  studentId: string,
  sha: string,
  parts: number,
): Promise<boolean> {
  if (parts === 1) return hasAssetPart(blobToken, studentId, sha, 0);
  try {
    await head(verifiedMarkerPath(studentId, sha), { token: blobToken });
    return true;
  } catch {
    /* not verified yet */
  }
  const h = createHash("sha256");
  for (let i = 0; i < parts; i++) {
    const buf = await readAssetPart(blobToken, studentId, sha, i);
    if (!buf) return false;
    h.update(buf);
  }
  if (h.digest("hex") !== sha) return false;
  await put(verifiedMarkerPath(studentId, sha), "ok", {
    access: "private", allowOverwrite: true, contentType: "text/plain", token: blobToken,
  });
  return true;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// Shape check for payload.externalAssets. Absent is fine (an older client,
// or a submission with nothing large enough to split out).
export function parseExternalAssets(
  value: unknown,
): { ok: true; value: Record<string, ExternalAssetMeta> } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: {} };
  if (!isRecord(value)) return { ok: false, error: "payload.externalAssets must be an object" };
  const out: Record<string, ExternalAssetMeta> = {};
  for (const [sha, meta] of Object.entries(value)) {
    if (!SHA256_RE.test(sha)) return { ok: false, error: `externalAssets key is not a sha256: ${sha.slice(0, 80)}` };
    if (!isRecord(meta)) return { ok: false, error: `externalAssets.${sha} must be an object` };
    const { mime, size, parts } = meta;
    if (typeof mime !== "string" || mime.length === 0 || mime.length > 200) {
      return { ok: false, error: `externalAssets.${sha}.mime is invalid` };
    }
    if (typeof size !== "number" || !Number.isInteger(size) || size < 0) {
      return { ok: false, error: `externalAssets.${sha}.size is invalid` };
    }
    if (typeof parts !== "number" || !Number.isInteger(parts) || parts < 1 || parts > MAX_ASSET_PARTS) {
      return { ok: false, error: `externalAssets.${sha}.parts is invalid` };
    }
    if (parts !== Math.max(1, Math.ceil(size / ASSET_PART_BYTES))) {
      return { ok: false, error: `externalAssets.${sha}.parts does not match its size` };
    }
    out[sha] = { mime, size, parts };
  }
  return { ok: true, value: out };
}

// Every `aict-asset:<sha>` reference in a payload's asset maps — the
// manuscript's figure map and each results bundle's artifact map.
export function collectAssetRefs(payload: Record<string, unknown>): string[] {
  const refs = new Set<string>();
  const scan = (m: unknown) => {
    if (!isRecord(m)) return;
    for (const v of Object.values(m)) {
      if (typeof v === "string" && v.startsWith(ASSET_REF_PREFIX)) refs.add(v.slice(ASSET_REF_PREFIX.length));
    }
  };
  const files = isRecord(payload.files) ? payload.files : {};
  if (isRecord(files.manuscript)) scan(files.manuscript.assets);
  for (const g of Array.isArray(files.executionPlans) ? files.executionPlans : []) {
    if (!isRecord(g)) continue;
    for (const b of Array.isArray(g.results) ? g.results : []) {
      if (isRecord(b)) scan(b.assets);
    }
  }
  return [...refs];
}
