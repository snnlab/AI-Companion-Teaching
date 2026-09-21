// Wire contract for the instructor-hosted classroom server's roster API
// (Phase 2 — see plans/master-plan.md "Instructor-hosted roster server").
// Deliberately separate from BoardData (./types.ts): BoardData describes ONE
// student's project (unchanged by this file); RosterData describes a COURSE
// across many students. The two are related only through `OutputScore`,
// reused verbatim (not redefined) so the roster's F·A·I chip can share
// exactly the same rendering code (OutputScorePanel) as the single-project
// board, and through `payload`, which — once a row is drilled into — IS a
// full, valid BoardData, unmodified.
//
// These shapes are shared with the classroom server implementation (a
// parallel, separate piece of work) and with skills/managing-aict's
// submit.py envelope. Do not change field names/shapes here without
// reconciling both sides.

import type { BoardData, OutputScore } from "./types";

export interface RosterData {
  schemaVersion: number;
  // `instructorName` (from the server's COURSE_INSTRUCTOR_NAME) pre-fills the
  // comment-author field when the instructor drills into a student's board.
  // null/absent -> the field starts empty, as before.
  course: { id: string; name?: string; instructorName?: string | null };
  generatedAt: string;
  students: RosterRow[];
}

// Server-side mechanical re-verification checks (reverify.ts): each entry is
// ONE named check (checksum recompute, trailer re-parse, sign-off-vs-git
// timing, …) with its own verdict. `match`/`mismatch` cover checks the server
// could fully recompute; `not-derivable` covers checks that had nothing to
// compare against (e.g. no git excerpt submitted); `flag` covers a descriptive
// signal worth a look (e.g. a timing anomaly) that isn't a binary pass/fail.
// Always render these with their own visual language — see
// components/TrustTierLegend.tsx — never the integrity block's pass/fail
// red/green vocabulary.
export type ReverifyStatus = "match" | "mismatch" | "not-derivable" | "flag";

export interface ReverifyCheck {
  check: string;
  status: ReverifyStatus;
  detail: string;
}

// Mirrors IntegrityBlock["status"] in ./types.ts plus "unknown" for a
// submission the server hasn't (yet) run its mechanical pass against.
export type RosterIntegrityStatus = "passed" | "failed" | "unknown";

export interface RosterSubmissionSummary {
  submittedAt: string;
  idempotencyKey: string;
  score: OutputScore | null;
  integrityStatus: RosterIntegrityStatus;
  reverify: ReverifyCheck[];
}

export interface SimilarityFlag {
  withStudentId: string;
  jaccard: number;
  artifact: string;
}

export interface RosterRow {
  studentId: string;
  displayName: string;
  // null = registered but never submitted yet.
  lastSubmission: RosterSubmissionSummary | null;
  submissionCount: number;
  similarityFlags: SimilarityFlag[];
  // True when lastSubmission postdates the instructor's previous roster
  // visit (server-computed from a single last-viewed pointer — see
  // classroom-template's lib/roster.ts). Optional so older cached payloads
  // without this field still parse; absence renders as "not new".
  isNewSinceLastView?: boolean;
}

// ---- GET /api/submissions/:studentId ----

export interface StudentSubmission {
  submittedAt: string;
  idempotencyKey: string;
  reverify: ReverifyCheck[];
  score: OutputScore | null;
  integrityStatus: RosterIntegrityStatus;
  // Full, valid BoardData — the exact shape App.tsx already renders today.
  payload: BoardData;
}

export interface StudentSubmissions {
  studentId: string;
  displayName: string;
  // Newest first.
  submissions: StudentSubmission[];
}

// ---- async fetch-state unions ----
// Matches this codebase's existing tagged-union convention for async/derived
// state (see lib/reconnect.ts's ConnPhase, lib/staleness.ts's StaleState):
// a string discriminant field, switched on directly in JSX rather than via
// separate loading/error/data booleans.

export type RosterFetchState =
  | { status: "loading" }
  | { status: "error"; message: string; unauthorized?: boolean }
  | { status: "ready"; data: RosterData };

export type StudentFetchState =
  | { status: "loading" }
  | { status: "error"; message: string; unauthorized?: boolean }
  | { status: "ready"; data: StudentSubmissions };
