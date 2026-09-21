// Mirrors the payload board.py injects into the #board-data slot (schemaVersion 1).

export interface BoardData {
  schemaVersion: number;
  generatedAt: string;
  mode: "live" | "static" | "remote" | "hosted";
  focus: string | null;
  focusResults?: number | null; // --focus slug:rN opens the Results view on rN
  focusView?: "reports" | null;
  drift?: {
    // filesystem/git hygiene flags (feature #7); researcher modes only
    staleBoardHtml: boolean | null;
    leftoverStaging: string[];
    sourceDrift: string[];
  };
  // agent plan review (v0.9): reviewer-produced comments injected via
  // board.py --seed-annotations; resolved to anchors in the browser on mount.
  seededAnnotations?: SeededAnnotation[];
  shareHash?: string; // remote mode: Python-computed, echoed back in feedback
  // hosted mode: pre-fills the comment-author field when it would otherwise
  // start blank (the roster server passes its COURSE_INSTRUCTOR_NAME here).
  // A value the reviewer has already typed on this device still wins.
  defaultReviewer?: string;
  projectId?: string; // live: stable server identity (draft storage + reconnect)
  boardToken?: string; // live: per-boot token required on mutating routes
  bootId?: string; // live: per-boot identity seeding the reconnect baseline (excluded from generation)
  generation?: string; // live: content identity of this served payload; compared against /api/health for auto-refresh
  sign?: SignPayload; // one-shot sign session; absent on the persistent board
  modelProfile?: ModelProfile; // per-stage model profile (Models tab); present-only
  detailLevel?: "compact" | "standard" | "full"; // master-plan "Detail level:"; default "standard"
  project: { name: string; root?: string };
  git: {
    available: boolean;
    branch?: string;
    head?: string;
    fileDates?: Record<string, { firstCommit?: string; lastCommit?: string }>;
  };
  files: {
    masterPlan: BoardFile;
    decisionLog: BoardFile;
    executionPlans: ExecutionPlanGroup[];
    reviews: BoardFile[];
    history?: BoardFile; // reconstructed pre-adoption history; present only when it exists
    archives?: ArchiveFile[]; // archived master plans (v0.10 renewal); present-only
  };
  publishToken?: string;
}

export interface BoardFile {
  path: string;
  content: string;
}

// ---- model profile (Models tab) ----

// One row of plans/model-profile.md as the board sees it. `label` is the
// verbatim display text (e.g. "plan (co-authoring)"); `mechanism` is read-only
// on the board; `effort` is null when unset (renders as "—").
export interface ModelProfileRow {
  stage: string; // canonical key: plan | execute | sync | plan-review | results-validation | board-reviewer
  label: string;
  model: string; // inherit | opus | sonnet | haiku | fable | claude-* id
  effort: string | null; // low | medium | high | xhigh | max | null
  mechanism: "nudge" | "agent";
}

// Server-built snapshot of the profile. `baselineHash` is echoed back on Save
// for optimistic concurrency; `editable` is false for a hand-edited /
// non-canonical / unreadable file (edit those via /aict:models).
export interface ModelProfile {
  path: string;
  exists: boolean;
  baselineHash: string | null;
  raw: string;
  proseBefore: string; // markdown above the table (explanation)
  proseAfter: string; // markdown below the table (defaults rationale)
  rows: ModelProfileRow[];
  editable: boolean;
  warnings: string[];
  agentsGitignored: boolean | null; // null when git unavailable / collaborator mode
}

// ---- model provenance (which model each part used) ----

// One side of a provenance record. `effort` is null when unknown (reported
// effort is generally not introspectable) or unset.
// Attached to a plan version, result bundle, report, or scorecard/validation:
// which model actually did the work, self-attested by that session. Never
// presented as verified runtime truth — nothing checks it at runtime.
export interface ModelUsage {
  model: string;
  effort: string | null;
}

// Result of a successful POST /api/model-profile (patched into App state).
export interface ModelProfileSaveResult {
  ok: true;
  saved: true;
  modelProfile: ModelProfile;
  restartNeeded: boolean;
  changedAgentStages: string[];
  generation: {
    results: { agent: string; stage: string; outcome: string }[];
    error?: string;
  };
  payloadGeneration?: string; // disk generation after the save (auto-refresh baseline)
}

// An archived master plan under plans/archive/ — immutable renewal record.
export interface ArchiveFile extends BoardFile {
  archivedOn?: string; // YYYY-MM-DD from the filename
}

export interface SignItem {
  component: string;
  proposedVersion: number;
  path: string;
  content: string;
  contentHash: string;
  ticketed: boolean;
}

export interface SignPayload {
  batchId: string;
  transport: "ticket" | "hook";
  items: SignItem[];
}

export interface ExecutionPlanGroup {
  component: string; // NN-slug
  versions: PlanVersionFile[];
  draft?: DraftFile;
  draftSnapshots?: DraftSnapshotFile[]; // committed within-version iterations (feature #1)
  results?: ResultsBundle[];
}

// ---- results bundles ----

export interface ResultsBundle {
  resultsVersion: number;
  dir: string;
  manifest: ResultsManifest | null;
  manifestRaw: BoardFile;
  report: BoardFile | null;
  verdict: ResultsVerdict | null;
  verdictRaw: BoardFile | null;
  scripts: BoardFile[];
  assets: Record<string, string>;
  publishedReport: BoardFile | null;
  reportFormats?: { pdf: boolean; docx: boolean };
}

export interface ResultsManifest {
  schemaVersion: number;
  component: string;
  resultsVersion: number;
  planVersion: number | null;
  provenance: "planned" | "retrofit";
  trigger: "initial" | "redo-after-review" | "plan-revision";
  capturedAt: string;
  curatedBy?: "agent";
  late?: boolean; // backfill: plan-governed work captured after the fact
  summary?: string;
  metrics: {
    label: string;
    value: string;
    note?: string;
    statement?: string; // finding-centric header: the claim sentence
    status?:
      | "robust"
      | "marginal"
      | "descriptive"
      | "retracted"
      | "superseded";
    artifactIds?: string[]; // artifact ids embedded under this finding
  }[];
  artifacts: ResultArtifact[];
  validation?: ValidationBlock; // v0.10: plan-vs-execution audit, sealed at capture
  modelUsage?: ModelUsage; // which model captured this bundle (reported = capture session)
  integrity?: IntegrityBlock; // mechanical integrity pass, sealed at finalize
}

// Mechanical, advisory integrity pass computed by results.py at finalize and
// sealed into the immutable manifest. Absent on bundles captured before this
// feature. Never a gate — a "failed" status is surfaced, not enforced.
export interface IntegrityBlock {
  status: "passed" | "failed";
  checkedAt?: string;
  checks: {
    name: string; // checksums | artifacts-present | artifact-refs | findings-sourced
    verdict: "pass" | "fail";
    detail?: string;
  }[];
}

// Independent-subagent audit of the bundle against its signed plan (v0.10).
// Advisory — never a gate; absent on pre-v0.10 bundles.
export interface ValidationBlock {
  status:
    | "conforms"
    | "conforms-with-amendments"
    | "deviations-found"
    | "unverifiable"
    | "not-applicable"
    | "skipped";
  validatedAt?: string;
  planVersion?: number | null;
  validator?: string;
  steps?: {
    planStep: string;
    verdict:
      | "followed"
      | "amended"
      | "deviated-unrecorded"
      | "not-executed"
      | "unverifiable";
    evidence?: string;
  }[];
  criteria?: {
    criterion: string;
    verdict: "met" | "not-met" | "partial" | "unverifiable";
    evidence?: string;
  }[];
  notes?: string;
  reason?: string; // for not-applicable / skipped / unverifiable
  modelUsage?: ModelUsage; // which model validated (reported = validator agent or session)
}

export interface ResultArtifact {
  id: string;
  kind: "figure" | "table" | "other";
  title: string;
  caption?: string;
  file: string | null;
  data?: string | null; // the estimates CSV behind a table (bundle-relative)
  tex?: string | null; // the .tex source of a typeset table (bundle-relative, v0.10)
  inlineText?: string;
  source: { path: string; sha256: string; bytes: number; oversized: boolean };
  producedBy: {
    script: string;
    sourcePath: string;
    lang?: string;
    // run recipe (additive, v0.6.3): present when the artifact can be
    // regenerated by re-running its producing code. See commands/results.md.
    command?: string[];
    cwd?: string;
    args?: string[];
    expectedOutputs?: string[];
    approvedHash?: string;
  } | null;
}

export interface ResultsVerdict {
  status: "accepted" | "changes-requested";
  date: string;
  planVersion: number | null;
  reviewer: string;
  comment?: string;
}

export type TrailerKind = "signed" | "amendment" | "none" | "malformed";

export interface PlanVersionFile extends BoardFile {
  version: number;
  trailerState?: TrailerKind;
}

export interface DraftFile extends BoardFile {
  proposedVersion: number;
  trailerState?: TrailerKind;
}

// A committed within-version draft iteration (vN-draft-K.md). Immutable by
// convention (the sign-off gate does not guard these names); read-only on the
// board — viewed and diffed, never annotated.
export interface DraftSnapshotFile extends BoardFile {
  version: number;
  iteration: number;
}

// ---- parsed shapes (client-side contract parsing; see parse.ts) ----

export interface ParsedMasterPlan {
  ok: boolean;
  title: string;
  lastUpdated: string | null;
  renewed: { date: string; reason: string } | null; // v0.10 Renewed: line
  contextMd: string; // Research questions subsection stripped out
  researchQuestions: ResearchQuestion[];
  components: TrackerRow[];
  foundationsMd: string | null; // v0.10 Foundations section (post-renewal)
  sequencingMd: string | null;
  raw: string;
}

export interface ResearchQuestion {
  num: number;
  text: string;
}

export type TrackerStatus =
  | "not started"
  | "planned"
  | "in progress"
  | "done"
  | "done (verified)"
  | "done (validated)"
  | "done (unvalidated)"
  | "done (retrofit)"
  | "dropped"
  | "unknown";

export interface TrackerRow {
  num: string;
  component: string;
  status: TrackerStatus;
  planLink: string;
  notes: string;
  serves: string; // raw Serves cell; "" for old 5-column tables
}

export interface ParsedLogEntry {
  timestamp: string;
  lateCaptured: boolean;
  autoCaptured: boolean;
  fields: { label: string; text: string }[];
  raw: string;
}

export interface ParsedHistoryEntry {
  date: string; // YYYY-MM or YYYY-MM-DD (date-granularity; never a clock time)
  sortKey: string; // YYYY-MM-DD (month → first of month) for ordering
  title: string;
  fields: { label: string; text: string }[];
  raw: string;
}

export interface ParsedExecutionPlan {
  ok: boolean;
  title: string;
  version: number | null;
  componentSlug: string | null;
  date: string | null;
  provenance: string | null; // "Provenance:" header; null = prospective
  supersedes: string | null;
  masterPlan: string | null;
  goal: string | null; // "Goal and success criteria" body; null in pre-v0.3 plans
  serves: string | null; // "Serves:" line inside the goal section
  sections: { heading: string; content: string }[];
  signedOff: string | null;
  trailerState: TrailerKind;
  raw: string;
}

// The five rubric channels (schemaVersion 3). Order is fixed: G · D · S · V · B.
export type ScorecardChannelId =
  | "goal"
  | "decisions"
  | "steps"
  | "validation"
  | "boundaries";

export const SCORECARD_CHANNEL_IDS: ScorecardChannelId[] = [
  "goal",
  "decisions",
  "steps",
  "validation",
  "boundaries",
];

export interface ScorecardChannel {
  id: ScorecardChannelId;
  name?: string;
  score: number; // integer 0..3
  evidence?: string;
  justification?: string;
}

// Non-scored workflow-integrity flags reported beside the profile.
export interface ScorecardIntegrityFlag {
  id: string; // "uncommitted" | "unsupported-sources" | "unrecorded-deviation" | …
  note?: string;
}

export interface Scorecard {
  schemaVersion: number;
  status?: "scored" | "unscorable"; // schemaVersion 3+; absent on legacy v1/v2
  component: string;
  planVersion: number;
  planPath: string;
  rubricVersion: string;
  date: string;
  // --- v3 scored ---
  channels?: ScorecardChannel[]; // exactly five when status === "scored"
  total?: number; // 0..15
  max?: number; // 15
  profile?: string; // "G3·D2·S2·V1·B0"
  biggestLeak?: { channel: string; note?: string };
  suggestedMoves?: string[];
  unresolvedForks?: string[];
  integrityFlags?: ScorecardIntegrityFlag[];
  // --- v3 unscorable ---
  reason?: string;
  // --- shared ---
  split?: { verdict: string; detail: string };
  modelUsage?: ModelUsage; // which model reviewed (reported = review agent or session)
  // --- legacy v1/v2 (a legacy scorecard still parses so it can render behind the
  //     "legacy review" affordance; on a v3 card these are absent at runtime — the
  //     parser casts, and only legacy code paths read them) ---
  threshold?: ScorecardThreshold;
  items: ScorecardItem[];
  raw: number | null;
  applicableMax: number | null;
  percent: number | null;
  band: string;
  excluded?: { id: number | string; why: string }[];
  topRevisions?: string[];
}

// A v3 scored scorecard, narrowed. Legacy or unscorable cards return false.
export function isScoredScorecard(
  sc: Scorecard | null | undefined,
): sc is Scorecard & { channels: ScorecardChannel[] } {
  return !!sc && sc.status === "scored" && Array.isArray(sc.channels);
}

export interface ScorecardThreshold {
  verdict: "pass" | "undetermined" | "fail";
  checks: ThresholdCheck[];
  failures?: { id: string; verdict: string; fix?: string }[];
}

export interface ThresholdCheck {
  id: string;
  name?: string;
  result: "pass" | "fail" | "na" | "unknown";
  evidence?: string;
  note?: string;
}

export interface ScorecardItem {
  id: number | string; // 1..14 in v1, "G1".."G8" in v2
  name?: string;
  score: number | null;
  status?: string; // "N/A" | "unknown" when score is null
  evidence?: string;
  justification?: string;
}

// ---- annotations ----

export interface PlanCommentAnnotation {
  id: string;
  type: "plan-comment";
  planPath: string;
  component: string;
  version: number;
  isDraft: boolean;
  quote: string;
  prefix: string;
  suffix: string;
  sectionHeading: string;
  scope?: string; // always "" on plans (no stamps); optional for stored legacy comments
  occurrenceIndex: number;
  anchored: boolean;
  comment: string;
  author?: string; // reviewer agent that produced it (v0.9); absent = the researcher
  // Instructor-flagged integrity concern (Phase 1). Absent = ordinary content
  // feedback; never set by seeded reviewer comments.
  category?: "integrity";
}

// ---- agent plan review (v0.9) ----

// Rides the feedback fence: the button submits it, the session runs the agent.
export interface ReviewRequest {
  agent: "codex" | "gemini" | "subagent" | "panel";
  scope: "plan" | "master" | "results";
  component?: string;
  version?: number; // plan scope: the plan version
  resultsVersion?: number; // results scope: the bundle
  planPath?: string;
  isDraft?: boolean;
}

// Rides the feedback fence like ReviewRequest: the Generate report button
// submits it, the session runs /aict:report on the bundle (v0.10).
export interface ReportRequest {
  component: string;
  resultsVersion: number;
}

// A reviewer's comment before browser anchoring. board.py --seed-annotations
// injects a list of these; App turns each into a pending annotation keyed by
// `scope`: plan → PlanCommentAnnotation, master → DocCommentAnnotation (tracker),
// results → ResultCommentAnnotation (report target). Missing scope defaults to
// "plan" (the original Phase-1 shape).
export interface SeededAnnotation {
  scope?: "plan" | "master" | "results";
  // common to every scope
  sectionHeading: string;
  quote: string;
  comment: string;
  author: string;
  // plan scope
  planPath?: string;
  component?: string; // plan + results
  version?: number;
  isDraft?: boolean;
  // results scope
  resultsVersion?: number;
}

export interface DocCommentAnnotation {
  id: string;
  type: "doc-comment";
  view: "tracker" | "timeline" | "reviews" | "archive" | "reports";
  docKey: string; // "tracker" | "timeline" | review file payload path | "archive:<path>"
  scope: string; // data-annot-scope id, "" when selection was outside stamps
  quote: string;
  prefix: string;
  suffix: string;
  sectionHeading: string;
  occurrenceIndex: number;
  anchored: boolean;
  comment: string;
  author?: string; // reviewer agent that produced it (v0.9); absent = the researcher
  // Instructor-flagged integrity concern (Phase 1). Absent = ordinary content
  // feedback; never set by seeded reviewer comments.
  category?: "integrity";
}

export interface ReopenRequest {
  component: string;
  resultsVersion: number;
  reason: string;
}

export interface GeneralAnnotation {
  id: string;
  type: "general";
  view: string;
  comment: string;
  author?: string;
  // Instructor-flagged integrity concern (Phase 1). Absent = ordinary content
  // feedback.
  category?: "integrity";
}

export interface ResultCommentAnnotation {
  id: string;
  type: "result-comment";
  component: string;
  resultsVersion: number;
  target: {
    kind: "artifact" | "report" | "metric";
    artifactId?: string;
    metricLabel?: string;
    quote?: string;
    occurrenceIndex?: number;
    // v0.11: the data-annot-scope the selection was made under (e.g.
    // "provenance:fig1" vs "artifact:fig1"), so the highlight repaints on the
    // surface where it was made. Absent on older annotations — the paint pass
    // then falls back to the scope derived from `kind`.
    surfaceScope?: string;
  };
  comment: string;
  author?: string; // reviewer agent that produced it (v0.9); absent = the researcher
  // Seeded reviewer comments (v0.9) start false and flip true when their report
  // quote paints; undefined on researcher-selected comments (always anchored).
  anchored?: boolean;
  // Instructor-flagged integrity concern (Phase 1). Absent = ordinary content
  // feedback; never set by seeded reviewer comments.
  category?: "integrity";
}

export interface ScriptCommentAnnotation {
  id: string;
  type: "script-comment";
  component: string;
  resultsVersion: number;
  script: string; // payload path of the snapshot
  lineStart: number;
  lineEnd: number;
  excerpt: string;
  comment: string;
  author?: string;
  // Instructor-flagged integrity concern (Phase 1). Absent = ordinary content
  // feedback.
  category?: "integrity";
}

export interface StoredComment {
  id: string;
  clientId: string;
  author: string;
  shareHash: string;
  docHash: string | null;
  annotation: Annotation;
  receivedAt: string;
}

export type Annotation =
  | PlanCommentAnnotation
  | GeneralAnnotation
  | ResultCommentAnnotation
  | ScriptCommentAnnotation
  | DocCommentAnnotation;
