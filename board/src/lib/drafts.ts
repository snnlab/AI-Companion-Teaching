// Live-board draft persistence (control surface). The live board stores
// pending annotations under a STABLE per-project key — the server's projectId
// — so a relaunch with changed payload never orphans unsent drafts. AICT
// is a brand-new tool with no pre-rename users, so there is no legacy key to
// migrate from — this just reads and writes the current key directly.
// Remote and hosted boards keep their own schemes untouched.

import type { Annotation } from "./types";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function liveDraftKey(projectId: string): string {
  return `aict-board:${projectId}:live`;
}

export function draftSuffixKey(base: string, suffix: "reviewer" | "seeded"): string {
  return `${base}:${suffix}`;
}

function readList(storage: StorageLike, key: string): Annotation[] {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as Annotation[]) : [];
  } catch {
    return [];
  }
}

/** Load the live drafts for a project from the stable key. */
export function loadDrafts(storage: StorageLike, projectId: string): Annotation[] {
  return readList(storage, liveDraftKey(projectId));
}

/** Remove ONLY the submitted annotation ids; unsubmitted drafts survive. */
export function clearSubmitted(
  storage: StorageLike,
  projectId: string,
  ids: string[],
): void {
  const key = liveDraftKey(projectId);
  const gone = new Set(ids);
  const kept = readList(storage, key).filter((a) => !gone.has(a.id));
  try {
    if (kept.length === 0) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, JSON.stringify(kept));
    }
  } catch {
    // storage unavailable — nothing to clear
  }
}
