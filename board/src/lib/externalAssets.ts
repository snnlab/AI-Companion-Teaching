// Roster drill-in: a submission may carry its figures and result files
// OUTSIDE the JSON payload (submit.py uploads them to the classroom server's
// /api/assets so no request or response crosses Vercel's 4.5 MB body cap).
// Inside the payload such a file is `aict-asset:<sha256>`, described in
// payload.externalAssets. Before handing the payload to App, swap every
// reference for a browser object URL built from the downloaded parts — so
// every view that already renders `assets[...]` as an <img src> or fetches
// it (assetText.ts) works unchanged.
import type { BoardData } from "./types";

export const ASSET_REF_PREFIX = "aict-asset:";

export interface ExternalAssetMeta {
  mime: string;
  size: number;
  parts: number;
}

type AssetMap = Record<string, string>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// Every asset map in a payload: the manuscript's figure map and each results
// bundle's artifact map (the same two board.py's build_assets fills).
function assetMaps(payload: BoardData): AssetMap[] {
  const files = (payload as unknown as { files?: Record<string, unknown> }).files ?? {};
  const maps: AssetMap[] = [];
  const m = files.manuscript;
  if (isRecord(m) && isRecord(m.assets)) maps.push(m.assets as AssetMap);
  for (const g of Array.isArray(files.executionPlans) ? files.executionPlans : []) {
    if (!isRecord(g)) continue;
    for (const b of Array.isArray(g.results) ? g.results : []) {
      if (isRecord(b) && isRecord(b.assets)) maps.push(b.assets as AssetMap);
    }
  }
  return maps;
}

export function assetRefs(payload: BoardData): string[] {
  const refs = new Set<string>();
  for (const map of assetMaps(payload)) {
    for (const v of Object.values(map)) {
      if (typeof v === "string" && v.startsWith(ASSET_REF_PREFIX)) refs.add(v.slice(ASSET_REF_PREFIX.length));
    }
  }
  return [...refs];
}

export type FetchPart = (sha: string, part: number) => Promise<ArrayBuffer>;

// Object URLs survive switching between a student's submissions, and the
// same file (same sha) is never downloaded twice in one session.
const urlCache = new Map<string, Promise<string>>();

export function resolveAsset(
  sha: string,
  meta: ExternalAssetMeta | undefined,
  fetchPart: FetchPart,
  cacheKey: string,
): Promise<string> {
  const hit = urlCache.get(cacheKey);
  if (hit) return hit;
  const parts = meta?.parts ?? 1;
  const p = Promise.all(Array.from({ length: parts }, (_, i) => fetchPart(sha, i))).then((bufs) =>
    URL.createObjectURL(new Blob(bufs, { type: meta?.mime ?? "application/octet-stream" })),
  );
  urlCache.set(cacheKey, p);
  p.catch(() => urlCache.delete(cacheKey));
  return p;
}

// A copy of `payload` with every reference replaced by an object URL. A file
// that fails to download is left as its reference, which renders as a broken
// image rather than blocking the whole board.
export async function hydrateExternalAssets(
  payload: BoardData,
  studentId: string,
  fetchPart: FetchPart,
): Promise<BoardData> {
  const refs = assetRefs(payload);
  if (refs.length === 0) return payload;
  const metaAll = (payload as unknown as { externalAssets?: Record<string, ExternalAssetMeta> }).externalAssets ?? {};
  const resolved = new Map<string, string>();
  await Promise.all(
    refs.map(async (sha) => {
      try {
        resolved.set(sha, await resolveAsset(sha, metaAll[sha], fetchPart, `${studentId}/${sha}`));
      } catch {
        /* leave the reference in place */
      }
    }),
  );
  const copy = structuredClone(payload);
  for (const map of assetMaps(copy)) {
    for (const [k, v] of Object.entries(map)) {
      if (typeof v !== "string" || !v.startsWith(ASSET_REF_PREFIX)) continue;
      const url = resolved.get(v.slice(ASSET_REF_PREFIX.length));
      if (url) map[k] = url;
    }
  }
  return copy;
}

export function rosterFetchPart(studentId: string): FetchPart {
  return async (sha, part) => {
    const qs = new URLSearchParams({ student: studentId, sha, part: String(part) });
    const res = await fetch(`/api/assets?${qs.toString()}`, { credentials: "include" });
    if (!res.ok) throw new Error(`asset ${sha} part ${part}: HTTP ${res.status}`);
    return res.arrayBuffer();
  };
}
