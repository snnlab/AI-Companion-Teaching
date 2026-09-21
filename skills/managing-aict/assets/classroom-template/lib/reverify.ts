// Server-side mechanical re-verification, run synchronously inside
// POST /api/submissions before storing. Four checks, run in order, each
// appending zero or more entries to a flat `ReverifyCheck[]`:
//
//   1. integrity/score recompute   — results.py's compute_integrity/compute_score
//   2. trailer canonicalization    — signoff_gate.py's parse_trailer
//   3. git-timing                  — new this round (gitExcerpt vs. trailer date)
//   4. missing-expected-artifact   — the low-Decisions sign-off override line
//
// Hard invariant (see AGENTS.md's "Comment-only instructor role" and
// results.py's own "advisory, never blocks finalize" philosophy): NOTHING in
// this file may cause a submission to be rejected. A malformed or oversized
// ENVELOPE is rejected elsewhere (lib/validate.ts, before this file ever
// runs); every check below reads best-effort from an opaque, already-
// admitted `payload` and degrades to "not-derivable" rather than throwing
// when the shape it expects isn't there. The vocabulary is always
// "match" | "mismatch" | "not-derivable" | "flag" — never "pass"/"fail",
// which stays reserved for the sealed, purely-arithmetic
// manifest.integrity/manifest.score blocks' own internal vocabulary (read
// here, never redefined).
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Small, defensive helpers for reading an opaque, client-controlled payload.
// Exported because api/roster.ts and api/submissions/[studentId].ts need the
// same "find the freshest results bundle in this BoardData-shaped payload"
// logic to surface a score/integrityStatus on the roster — duplicating a
// second copy of these guards there would be the kind of drift this file
// already warns against for the trailer grammar.
// ---------------------------------------------------------------------------

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Walks payload.files.executionPlans[].results[] (BoardData's
// ExecutionPlanGroup[]/ResultsBundle[] shape, read structurally rather than
// imported from board/src/lib/types.ts — this template does not depend on
// board/src/) and returns the manifest with the latest `capturedAt` string
// across every component and every results version, or null if none exist.
// `capturedAt` is always "YYYY-MM-DD HH:MM" (results.py's own format), so
// plain string comparison orders correctly.
export function findFreshestManifest(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  const files = isRecord(payload.files) ? payload.files : null;
  const groups = files ? asArray(files.executionPlans).filter(isRecord) : [];
  let best: Record<string, unknown> | null = null;
  let bestAt = "";
  for (const g of groups) {
    for (const bundle of asArray(g.results).filter(isRecord)) {
      const manifest = isRecord(bundle.manifest) ? bundle.manifest : null;
      if (!manifest) continue;
      const capturedAt = str(manifest.capturedAt) ?? "";
      if (best === null || capturedAt >= bestAt) {
        best = manifest;
        bestAt = capturedAt;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Check 1: integrity/score recompute (ports results.py's compute_integrity
// and compute_score).
// ---------------------------------------------------------------------------

export interface IntegrityCheckResult { name: string; verdict: "pass" | "fail"; detail: string }
export interface IntegrityResult { status: "passed" | "failed"; checkedAt: string; checks: IntegrityCheckResult[] }

// Reads an artifact's bytes from the bundle's `assets` map (the same map
// board.py's build_assets() fills for a non-live payload: basename ->
// "data:<mime>;base64,<data>"). `file` is the manifest-relative path (e.g.
// "artifacts/figure1.png" per results.py's copy command); only the basename
// is used to look it up, matching build_assets()'s own basename keying.
function assetBytes(assets: Record<string, string>, file: string): Buffer | null {
  const base = file.split("/").pop() ?? file;
  const uri = assets[base];
  if (!uri) return null;
  const comma = uri.indexOf(",");
  if (comma < 0) return null;
  try {
    return Buffer.from(uri.slice(comma + 1), "base64");
  } catch {
    return null;
  }
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// Kept in sync with results.py's is_substantive and board/src/lib/findings.ts
// isSubstantive (that comment is already in results.py — this file is a
// third copy of the same rule; change all three together).
function isSubstantive(metric: Record<string, unknown>): boolean {
  const st = str(metric.status);
  if (st === "robust" || st === "marginal") return true;
  const stmt = (str(metric.statement) ?? "").trim();
  const demoted = new Set(["descriptive", "retracted", "superseded"]);
  return stmt.length > 0 && !(st !== null && demoted.has(st));
}

export function computeIntegrity(
  manifest: Record<string, unknown>,
  assets: Record<string, string>,
  now?: string,
): IntegrityResult {
  const arts = asArray(manifest.artifacts).filter(isRecord);
  const artIds = new Set(arts.map((a) => a.id));
  const checks: IntegrityCheckResult[] = [];

  const badSum: string[] = [];
  const missing: string[] = [];
  for (const a of arts) {
    const f = str(a.file);
    if (f === null) continue; // oversized / inline-only artifacts carry no bundle copy
    const bytes = assetBytes(assets, f);
    if (bytes === null) {
      missing.push(f);
      continue;
    }
    const source = isRecord(a.source) ? a.source : {};
    const sha = str(source.sha256);
    if (!sha) badSum.push(`${f} (no recorded sha256)`);
    else if (sha256Hex(bytes) !== sha) badSum.push(f);
  }
  checks.push({
    name: "checksums",
    verdict: badSum.length === 0 ? "pass" : "fail",
    detail: badSum.length === 0
      ? "all artifact copies match their source hashes"
      : `checksum mismatch: ${badSum.join(", ")}`,
  });
  checks.push({
    name: "artifacts-present",
    verdict: missing.length === 0 ? "pass" : "fail",
    detail: missing.length === 0
      ? "all artifact files present in the bundle"
      : `missing artifact files: ${missing.join(", ")}`,
  });

  const metrics = asArray(manifest.metrics).filter(isRecord);
  const badRefs: string[] = [];
  for (const mt of metrics) {
    for (const aid of asArray(mt.artifactIds)) {
      if (!artIds.has(aid)) badRefs.push(`${str(mt.label) ?? "?"}->${String(aid)}`);
    }
  }
  checks.push({
    name: "artifact-refs",
    verdict: badRefs.length === 0 ? "pass" : "fail",
    detail: badRefs.length === 0
      ? "every metric references a real artifact"
      : `dangling artifact references: ${badRefs.join(", ")}`,
  });

  const unsourced = metrics
    .filter((mt) => isSubstantive(mt) && asArray(mt.artifactIds).length === 0)
    .map((mt) => str(mt.label) ?? "?");
  checks.push({
    name: "findings-sourced",
    verdict: unsourced.length === 0 ? "pass" : "fail",
    detail: unsourced.length === 0
      ? "every substantive finding cites an artifact"
      : `unsourced findings: ${unsourced.join(", ")} (attach an artifact or mark the metric descriptive)`,
  });

  const status: "passed" | "failed" = checks.every((c) => c.verdict === "pass") ? "passed" : "failed";
  return { status, checkedAt: now ?? new Date().toISOString(), checks };
}

export interface ScoreChannel {
  id: "fidelity" | "attainment" | "integrity";
  name: string;
  score: number | null;
  basis: string;
}
export interface ScoreResult {
  schemaVersion: number;
  channels: ScoreChannel[];
  profile: string;
  total: number | null;
  max: number;
  computedAt: string;
}

type Tier = [string[], number];
const STEP_TIERS: Tier[] = [
  [["deviated-unrecorded", "not-executed"], 0],
  [["unverifiable"], 1],
  [["amended"], 2],
];
const CRITERION_TIERS: Tier[] = [
  [["not-met"], 0],
  [["unverifiable"], 1],
  [["partial"], 2],
];
const INTEGRITY_RANK: Record<string, number> = {
  checksums: 0,
  "artifacts-present": 0,
  "artifact-refs": 1,
  "findings-sourced": 2,
};

function verdictChannel(
  items: unknown,
  labelKey: string,
  tiers: Tier[],
  bestVerdict: string,
  noun: string,
): [number | null, string] {
  const list = Array.isArray(items) ? items.filter(isRecord) : null;
  if (!list || list.length === 0) return [null, `no ${noun} recorded`];
  const recognized = new Set<string>([bestVerdict, ...tiers.flatMap(([vs]) => vs)]);
  const unknown = Array.from(
    new Set(list.map((it) => String(it.verdict)).filter((v) => !recognized.has(v))),
  ).sort();
  const scored = list.filter((it) => recognized.has(String(it.verdict)));
  const note = unknown.length > 0 ? `; ignored unknown verdicts: ${unknown.join(", ")}` : "";
  if (scored.length === 0) return [null, `no recognizable verdicts${note}`];
  for (const [verdicts, score] of tiers) {
    const hits = scored.filter((it) => verdicts.includes(String(it.verdict)));
    if (hits.length > 0) {
      const first = str(hits[0][labelKey]) ?? "?";
      return [score, `${hits.length} ${noun} ${verdicts.join("/")}, first: '${first}'${note}`];
    }
  }
  return [3, `all ${scored.length} ${noun} ${bestVerdict}${note}`];
}

function integrityChannel(integrity: unknown): [number | null, string] {
  if (!isRecord(integrity)) return [null, "no integrity block"];
  const checks = Array.isArray(integrity.checks) ? integrity.checks.filter(isRecord) : null;
  if (!checks || checks.length === 0) return [null, "no integrity checks recorded"];
  const fails = checks.filter((c) => c.verdict === "fail");
  const knownFails = fails.filter((c) => typeof c.name === "string" && c.name in INTEGRITY_RANK);
  const unknown = Array.from(
    new Set(checks.map((c) => String(c.name)).filter((n) => !(n in INTEGRITY_RANK))),
  ).sort();
  const note = unknown.length > 0 ? `; ignored unknown checks: ${unknown.join(", ")}` : "";
  const status = str(integrity.status);
  const expected = fails.length > 0 ? "failed" : "passed";
  const disagree = (status === "passed" || status === "failed") && status !== expected
    ? `; note: recorded status '${status}' disagrees with the checks`
    : "";
  if (knownFails.length === 0) {
    const base = fails.length === 0 ? `all ${checks.length} checks pass` : "no recognized check failed";
    return [3, base + note + disagree];
  }
  const score = Math.min(...knownFails.map((c) => INTEGRITY_RANK[String(c.name)]));
  const worst = knownFails.filter((c) => INTEGRITY_RANK[String(c.name)] === score);
  const names = Array.from(new Set(worst.map((c) => String(c.name)))).sort().join(", ");
  const firstDetail = (str(worst[0].detail) ?? "").trim();
  const detail = firstDetail ? ` — ${firstDetail}` : "";
  return [score, `${worst.length} check(s) failed: ${names}${detail}${note}${disagree}`];
}

export function computeScore(validation: unknown, integrity: unknown, now?: string): ScoreResult {
  const val = isRecord(validation) ? validation : null;
  const status = val ? str(val.status) : null;
  let f: [number | null, string];
  let a: [number | null, string];
  if (val === null) {
    f = [null, "no validation block"];
    a = [null, "no validation block"];
  } else if (status === "not-applicable" || status === "skipped") {
    const reason = status === "not-applicable" ? "retrofit" : "skipped";
    f = [null, `no plan validation (${reason})`];
    a = [null, `no plan validation (${reason})`];
  } else {
    f = verdictChannel(val.steps, "planStep", STEP_TIERS, "followed", "steps");
    a = verdictChannel(val.criteria, "criterion", CRITERION_TIERS, "met", "criteria");
  }
  const i = integrityChannel(integrity);
  const channels: ScoreChannel[] = [
    { id: "fidelity", name: "Fidelity", score: f[0], basis: f[1] },
    { id: "attainment", name: "Attainment", score: a[0], basis: a[1] },
    { id: "integrity", name: "Integrity", score: i[0], basis: i[1] },
  ];
  const scores = channels.map((c) => c.score);
  const total = scores.every((s) => typeof s === "number")
    ? (scores as number[]).reduce((x, y) => x + y, 0)
    : null;
  const letters = ["F", "A", "I"];
  const profile = channels.map((c, idx) => `${letters[idx]}${c.score === null ? "–" : c.score}`).join("·");
  return { schemaVersion: 1, channels, profile, total, max: 9, computedAt: now ?? new Date().toISOString() };
}

function integrityEquivalent(recomputed: IntegrityResult, sealed: unknown): boolean {
  // Compares status + per-check {name, verdict} only — not the free-text
  // `detail` or `checkedAt` — so a re-verification never false-flags on
  // cosmetic formatting differences. Verdict-level agreement is the actual
  // signal; the detail text is auxiliary explanation.
  if (!isRecord(sealed)) return false;
  if (recomputed.status !== sealed.status) return false;
  const sealedChecks = Array.isArray(sealed.checks) ? sealed.checks.filter(isRecord) : null;
  if (!sealedChecks || sealedChecks.length !== recomputed.checks.length) return false;
  for (let idx = 0; idx < recomputed.checks.length; idx += 1) {
    const x = recomputed.checks[idx];
    const y = sealedChecks[idx];
    if (str(y.name) !== x.name || str(y.verdict) !== x.verdict) return false;
  }
  return true;
}

function scoreEquivalent(recomputed: ScoreResult, sealed: unknown): boolean {
  if (!isRecord(sealed)) return false;
  const sealedTotal = typeof sealed.total === "number" ? sealed.total : null;
  return str(sealed.profile) === recomputed.profile && sealedTotal === recomputed.total;
}

function reverifyResultsBundles(
  executionPlans: Record<string, unknown>[],
  out: ReverifyCheck[],
): void {
  for (const group of executionPlans) {
    const component = str(group.component) ?? "?";
    for (const bundle of asArray(group.results).filter(isRecord)) {
      const rv = num(bundle.resultsVersion);
      const label = `${component} r${rv ?? "?"}`;
      const manifest = isRecord(bundle.manifest) ? bundle.manifest : null;
      if (!manifest) {
        out.push({
          check: `integrity:${label}`,
          status: "not-derivable",
          detail: `no manifest present for ${label}; cannot recompute integrity or score.`,
        });
        continue;
      }
      const rawAssets = isRecord(bundle.assets) ? bundle.assets : {};
      const assets: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawAssets)) if (typeof v === "string") assets[k] = v;

      const recomputedIntegrity = computeIntegrity(manifest, assets);
      const sealedIntegrity = manifest.integrity;
      if (sealedIntegrity === undefined || sealedIntegrity === null) {
        out.push({
          check: `integrity:${label}`,
          status: "not-derivable",
          detail: `${label} carries no sealed integrity block to compare against (pre-integrity bundle); recomputed status is ${recomputedIntegrity.status}.`,
        });
      } else if (integrityEquivalent(recomputedIntegrity, sealedIntegrity)) {
        out.push({
          check: `integrity:${label}`,
          status: "match",
          detail: `recomputed integrity (${recomputedIntegrity.status}) matches the sealed manifest.`,
        });
      } else {
        out.push({
          check: `integrity:${label}`,
          status: "mismatch",
          detail: `recomputed integrity (${recomputedIntegrity.status}) differs from the sealed manifest for ${label} — the manifest may have been edited after it was sealed.`,
        });
      }

      const recomputedScore = computeScore(manifest.validation, recomputedIntegrity);
      const sealedScore = manifest.score;
      if (sealedScore === undefined || sealedScore === null) {
        out.push({
          check: `score:${label}`,
          status: "not-derivable",
          detail: `${label} carries no sealed score block to compare against; recomputed profile is ${recomputedScore.profile}.`,
        });
      } else if (scoreEquivalent(recomputedScore, sealedScore)) {
        out.push({
          check: `score:${label}`,
          status: "match",
          detail: `recomputed score (${recomputedScore.profile}) matches the sealed manifest.`,
        });
      } else {
        const sealedProfile = isRecord(sealedScore) ? str(sealedScore.profile) ?? "?" : "?";
        out.push({
          check: `score:${label}`,
          status: "mismatch",
          detail: `recomputed score (${recomputedScore.profile}) differs from the sealed manifest score (${sealedProfile}) for ${label} — worth asking about.`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Checks 2 + 3: trailer canonicalization + git-timing.
//
// normalizePlan/parseTrailer below are now a THIRD independent
// implementation of signoff_gate.py's normalize_plan/parse_trailer grammar:
// Python original -> board/src/lib/trailer.ts's TypeScript port (the board
// UI) -> this file's re-port for server-side re-verification. All three MUST
// classify every plan the same way, or a plan the gate/board accept could
// get flagged as malformed here (or vice versa). parseTrailer below is
// deliberately re-ported from board/src/lib/trailer.ts line-for-line (per
// this template's own build instructions, trailer.ts is the reference —
// it's already proven correct against the shared fixture suite), not
// reinvented from the Python source cold. See reverify.test.ts, which reads
// the SAME fixture directory board/src/lib/__fixtures__/trailer/ this
// module's test uses, and its top-of-file note on the cross-directory path.
// If you change the trailer grammar, change it in all three places and
// re-run that test.
// ---------------------------------------------------------------------------

export type TrailerKind = "signed" | "amendment" | "none" | "malformed";
export interface TrailerResult { kind: TrailerKind; line: string | null; violations: string[] }

const TRAILER_SIGNED_RE = /^Signed off: .+$/;
const TRAILER_AMEND_RE = /^Amendment recorded, \d{4}-\d{2}-\d{2}$/;

export function parseTrailer(text: string): TrailerResult {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let idx = lines.length - 1;
  while (idx >= 0 && !lines[idx].trim()) idx -= 1;
  const final = idx >= 0 ? lines[idx].trim() : "";
  let kind: TrailerKind = "none";
  if (TRAILER_SIGNED_RE.test(final)) kind = "signed";
  else if (TRAILER_AMEND_RE.test(final)) kind = "amendment";
  const violations: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const value = lines[i].trim();
    if (i === idx && kind !== "none") continue;
    if (TRAILER_SIGNED_RE.test(value) || TRAILER_AMEND_RE.test(value)) {
      violations.push(`line ${i + 1}: ${value}`);
    }
  }
  if (violations.length > 0) {
    return { kind: "malformed", line: kind !== "none" ? final : null, violations };
  }
  return { kind, line: kind !== "none" ? final : null, violations: [] };
}

// Ported from signoff_gate.py's normalize_plan — canonical plan text
// invariant to the sign-off trailer. Used by the trailer checks indirectly
// (via parseTrailer's own grammar) and directly by lib/similarity.ts, which
// reuses it to strip a trailer before shingling.
export function normalizePlan(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((ln) => ln.replace(/\s+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length > 0 && lines[lines.length - 1].startsWith("Signed off:")) {
    lines.pop();
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    if (lines.length > 0 && lines[lines.length - 1] === "---") lines.pop();
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

function parseSignedTrailerLine(line: string): { name: string; date: string } | null {
  const m = /^Signed off: (.+), (\d{4}-\d{2}-\d{2})$/.exec(line);
  if (!m) return null;
  return { name: m[1], date: m[2] };
}

// JUDGMENT CALL (documented in the delivery report): the frozen v1 envelope
// contract's gitExcerpt.commits carries hash/authorDate/authorName/subject
// only — no per-commit file list. "a commit touching that plan's file path"
// therefore cannot be determined with certainty from this envelope shape
// alone. This function upgrades to exact matching when a commit DOES carry
// an (optional, forward-compatible — see lib/validate.ts's GitExcerptCommit)
// `files` array, and otherwise falls back to a subject-line heuristic: a
// commit whose one-line subject mentions the file's basename or its
// containing component slug. The excerpt is already scoped to `plans/`
// paths by submit.py's git_log_excerpt() (per the design plan), so this
// fallback trades precision for availability — false negatives (missing a
// real match) are more likely than false positives.
function commitsTouchingPath(
  commits: { hash: string; authorDate: string; authorName: string | null; subject: string; files?: string[] }[],
  rawPath: string,
): typeof commits {
  // Defend against a client that sent Windows-style separators (older
  // board.py on Windows did): the slug/basename split below is "/"-only.
  const path = rawPath.replace(/\\/g, "/");
  const base = path.split("/").pop() ?? path;
  const withFiles = commits.filter((c) => Array.isArray(c.files));
  if (withFiles.length > 0) {
    return withFiles.filter((c) => (c.files ?? []).some((f) => f === path || f === base || f.endsWith(`/${base}`)));
  }
  const parts = path.split("/");
  const slug = parts.length >= 3 ? parts[2] : null; // plans/execution/<slug>/vN.md
  return commits.filter((c) => c.subject.includes(base) || (slug !== null && c.subject.includes(slug)));
}

function dayWithinGrace(claimedDay: string, earliestDay: string, graceDays: number): boolean {
  const claimed = Date.parse(`${claimedDay}T00:00:00Z`);
  const earliest = Date.parse(`${earliestDay}T00:00:00Z`);
  if (Number.isNaN(claimed) || Number.isNaN(earliest)) return true; // fail open; caller already guards not-derivable cases
  const diffDays = (earliest - claimed) / 86_400_000;
  return diffDays <= graceDays;
}

// Same-day timezone slack: a commit authored the calendar day after the
// claimed sign-off date still counts as "on time" (the student's local day
// and the git author-date's day/timezone need not agree exactly). This is a
// starting value, not a calibrated final one — documented as a judgment
// call in the delivery report, same spirit as similarity.ts's threshold.
const GIT_TIMING_GRACE_DAYS = 1;

function reverifyPlanVersions(
  executionPlans: Record<string, unknown>[],
  gitExcerpt: { available: boolean; commits: { hash: string; authorDate: string; authorName: string | null; subject: string; files?: string[] }[] },
  out: ReverifyCheck[],
): void {
  for (const group of executionPlans) {
    const component = str(group.component) ?? "?";
    for (const v of asArray(group.versions).filter(isRecord)) {
      const versionNum = num(v.version);
      const content = str(v.content) ?? "";
      const path = str(v.path) ?? `plans/execution/${component}/v${versionNum ?? "?"}.md`;
      const label = `${component} v${versionNum ?? "?"}`;
      const trailer = parseTrailer(content);

      // Check 2: trailer canonicalization.
      if (trailer.kind === "malformed") {
        out.push({
          check: `trailer:${label}`,
          status: "mismatch",
          detail: `trailer grammar violation in ${label}: ${trailer.violations.join("; ")}`,
        });
      } else {
        out.push({
          check: `trailer:${label}`,
          status: "match",
          detail: trailer.kind === "none"
            ? `${label} carries no sign-off trailer (draft).`
            : `${label} trailer is well-formed: "${trailer.line}".`,
        });
      }

      // Check 3: git-timing — only meaningful for a signed version with a
      // parseable "Signed off: <name>, <date>" trailer.
      if (trailer.kind !== "signed") continue;
      const parsedSigned = parseSignedTrailerLine(trailer.line ?? "");
      if (!parsedSigned) {
        out.push({
          check: `git-timing:${label}`,
          status: "not-derivable",
          detail: `${label}'s trailer is signed but its date could not be parsed from "${trailer.line}".`,
        });
        continue;
      }
      if (!gitExcerpt.available || gitExcerpt.commits.length === 0) {
        out.push({
          check: `git-timing:${label}`,
          status: "not-derivable",
          detail: `no git history was included in this submission; the claimed sign-off date for ${label} (${parsedSigned.date}) could not be checked against commit timing.`,
        });
        continue;
      }
      const touching = commitsTouchingPath(gitExcerpt.commits, path);
      if (touching.length === 0) {
        out.push({
          check: `git-timing:${label}`,
          status: "flag",
          detail: `No commit touching ${path} was found in the submitted git history for ${label} — the excerpt window may simply not reach back far enough.`,
        });
        continue;
      }
      const earliest = touching.reduce((min, c) => (c.authorDate < min.authorDate ? c : min));
      const earliestDay = earliest.authorDate.slice(0, 10);
      const claimedDay = parsedSigned.date;
      if (dayWithinGrace(claimedDay, earliestDay, GIT_TIMING_GRACE_DAYS)) {
        out.push({
          check: `git-timing:${label}`,
          status: "match",
          detail: `earliest commit touching ${path} is ${earliestDay}, consistent with the claimed sign-off date ${claimedDay}.`,
        });
      } else {
        out.push({
          check: `git-timing:${label}`,
          status: "flag",
          detail: `The signed trailer for \`${component}\` v\`${versionNum}\` claims \`${claimedDay}\`, but the earliest commit touching that file in the submitted history is \`${earliestDay}\` — worth asking about.`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check 4: missing-expected-artifact — the low-Decisions sign-off override.
// The exact required decision-log phrasing is specified in commands/sign.md
// step 4: "Signed off despite low Decisions score (channel=<N>) — student
// proceeded without revision." A scorecard is read from
// payload.files.reviews (BoardFile[] whose content embeds a fenced
// ```json board-scorecard``` block, per
// skills/managing-aict/templates/review-scorecard.md).
// ---------------------------------------------------------------------------

const LOW_DECISIONS_OVERRIDE_RE =
  /Signed off despite low Decisions score \(channel=\d+\) — student proceeded without revision\./;
const SCORECARD_FENCE_RE = /```json board-scorecard\n([\s\S]*?)\n```/;

interface Scorecard { component: string | null; planVersion: number | null; decisionsScore: number | null; date: string | null }

function parseScorecard(review: Record<string, unknown>): Scorecard | null {
  const content = str(review.content);
  if (!content) return null;
  const m = SCORECARD_FENCE_RE.exec(content);
  if (!m) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(m[1]);
  } catch {
    return null;
  }
  if (!isRecord(doc)) return null;
  const channels = asArray(doc.channels).filter(isRecord);
  const decisions = channels.find((c) => c.id === "decisions");
  return {
    component: str(doc.component),
    planVersion: num(doc.planVersion),
    decisionsScore: decisions ? num(decisions.score) : null,
    date: str(doc.date),
  };
}

function reverifyDecisionOverride(
  payload: Record<string, unknown>,
  executionPlans: Record<string, unknown>[],
  decisionLogContent: string,
  out: ReverifyCheck[],
): void {
  const files = isRecord(payload.files) ? payload.files : {};
  const scorecards = asArray(files.reviews)
    .filter(isRecord)
    .map(parseScorecard)
    .filter((s): s is Scorecard => s !== null);

  let anySignedVersion = false;
  for (const group of executionPlans) {
    const component = str(group.component) ?? "?";
    for (const v of asArray(group.versions).filter(isRecord)) {
      const versionNum = num(v.version);
      const content = str(v.content) ?? "";
      const trailer = parseTrailer(content);
      if (trailer.kind !== "signed") continue;
      anySignedVersion = true;
      const label = `${component} v${versionNum ?? "?"}`;

      const matching = scorecards.filter((s) => s.component === component && s.planVersion === versionNum);
      if (matching.length === 0) {
        out.push({
          check: `decisions-override:${label}`,
          status: "not-derivable",
          detail: `no scorecard was found for ${label}; whether a low-Decisions override applied cannot be determined from this submission.`,
        });
        continue;
      }
      matching.sort((x, y) => (x.date ?? "").localeCompare(y.date ?? ""));
      const scorecard = matching[matching.length - 1];
      if (scorecard.decisionsScore === null) {
        out.push({
          check: `decisions-override:${label}`,
          status: "not-derivable",
          detail: `${label}'s scorecard has no readable Decisions channel score.`,
        });
        continue;
      }
      if (scorecard.decisionsScore >= 2) {
        out.push({
          check: `decisions-override:${label}`,
          status: "match",
          detail: `${label}'s Decisions channel scored ${scorecard.decisionsScore}/3 — no override was required.`,
        });
        continue;
      }
      if (LOW_DECISIONS_OVERRIDE_RE.test(decisionLogContent)) {
        out.push({
          check: `decisions-override:${label}`,
          status: "match",
          detail: `${label}'s Decisions channel scored ${scorecard.decisionsScore}/3; the required override entry is present in the decision log.`,
        });
      } else {
        out.push({
          check: `decisions-override:${label}`,
          status: "flag",
          detail: `${label}'s Decisions channel scored ${scorecard.decisionsScore}/3, but no matching "Signed off despite low Decisions score" entry was found in the decision log.`,
        });
      }
    }
  }
  if (!anySignedVersion) {
    out.push({
      check: "decisions-override",
      status: "not-derivable",
      detail: "no signed plan versions were present in this submission.",
    });
  }
}

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

export interface ReverifyCheck {
  check: string;
  status: "match" | "mismatch" | "not-derivable" | "flag";
  detail: string;
}

export function reverifySubmission(
  payload: unknown,
  gitExcerpt: { available: boolean; commits: { hash: string; authorDate: string; authorName: string | null; subject: string; files?: string[] }[] },
): ReverifyCheck[] {
  const results: ReverifyCheck[] = [];
  if (!isRecord(payload)) {
    results.push({
      check: "payload-shape",
      status: "not-derivable",
      detail: "the submitted payload is not a recognizable object; none of the mechanical re-checks could run.",
    });
    return results;
  }
  const files = isRecord(payload.files) ? payload.files : {};
  const executionPlans = asArray(files.executionPlans).filter(isRecord);
  const decisionLogContent = isRecord(files.decisionLog) ? str(files.decisionLog.content) ?? "" : "";

  reverifyResultsBundles(executionPlans, results);
  reverifyPlanVersions(executionPlans, gitExcerpt, results);
  reverifyDecisionOverride(payload, executionPlans, decisionLogContent, results);

  return results;
}
