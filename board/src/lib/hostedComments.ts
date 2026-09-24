import type { Annotation, BoardData, ExecutionPlanGroup, StoredComment } from "./types";
import { REPORT_DOCKEY_RE, stripMarkerLine } from "./reportMarker";

export function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  let hex = "";
  for (let i = 0; i < 32; i++) hex += Math.floor(Math.random() * 16).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const CLIENT_KEY = "aict-board:clientId";
export function getClientId(storage: Storage): string {
  let id = storage.getItem(CLIENT_KEY);
  if (!id) { id = newUuid(); storage.setItem(CLIENT_KEY, id); }
  return id;
}

function hashContent(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function findExecGroup(data: BoardData, component: string): ExecutionPlanGroup | undefined {
  return data.files.executionPlans.find((g) => g.component === component);
}

/** The content of the annotation's target document, if file-backed; else null. */
export function targetHash(data: BoardData, a: Annotation): string | null {
  if (a.type === "plan-comment") {
    const g = findExecGroup(data, a.component);
    const v = g?.versions.find((x) => x.version === a.version);
    return v ? hashContent(v.content) : null;
  }
  if (a.type === "result-comment" || a.type === "script-comment") {
    // Scope to the SPECIFIC results version — hashing the whole results array
    // would stale every comment whenever any other version is added/changed.
    const g = findExecGroup(data, a.component);
    const rv = g?.results?.find((r) => r.resultsVersion === a.resultsVersion);
    if (!rv) return null;
    // The bundle is immutable; the DERIVED report fields are not — a report
    // regeneration or a pandoc run must never stale comments on the bundle.
    const { publishedReport: _pr, reportFormats: _rf, ...bundleOnly } = rv;
    return hashContent(JSON.stringify(bundleOnly));
  }
  if (a.type === "doc-comment" && a.view === "reports") {
    const m = REPORT_DOCKEY_RE.exec(a.docKey);
    if (!m) return null;
    const g = findExecGroup(data, m[1]);
    const rv = g?.results?.find((r) => r.resultsVersion === Number(m[2]));
    // Marker-stripped: regeneration that only restamps the marker must not
    // stale every comment on an unchanged report body.
    return rv?.publishedReport
      ? hashContent(stripMarkerLine(rv.publishedReport.content))
      : null;
  }
  if (a.type === "doc-comment" && a.view === "manuscript") {
    // No marker to strip — the manuscript is raw student prose, not an
    // AI-marked document. Board.py's _doc_stale mirrors this exactly.
    const m = data.files.manuscript;
    return m && m.path === a.docKey ? hashContent(m.content) : null;
  }
  // doc-comment (a derived view) and general: no single file — fall back to board hash.
  return null;
}

export function isStale(c: StoredComment, data: BoardData): boolean {
  if (c.docHash != null) return targetHash(data, c.annotation) !== c.docHash;
  return c.shareHash !== data.shareHash;
}

export function partitionComments(
  server: StoredComment[], data: BoardData,
): { live: StoredComment[]; stale: StoredComment[] } {
  const live: StoredComment[] = []; const stale: StoredComment[] = [];
  for (const c of server) (isStale(c, data) ? stale : live).push(c);
  return { live, stale };
}

export function applyPostResult(pending: Annotation[], id: string, ok: boolean): Annotation[] {
  return ok ? pending.filter((a) => a.id !== id) : pending;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildCommentBody(a: Annotation, data: BoardData, author: string, clientId: string) {
  return {
    id: a.id && UUID_RE.test(a.id) ? a.id : newUuid(),
    clientId, author, shareHash: data.shareHash ?? "",
    docHash: targetHash(data, a),
    annotation: a,
  };
}
