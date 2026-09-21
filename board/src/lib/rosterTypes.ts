// Wire contract for the instructor-hosted classroom server's roster API
// (Phase 2 — see plans/master-plan.md "Instructor-hosted roster server").
// Deliberately separate from BoardData (./types.ts): BoardData describes ONE
// student's project (unchanged by this file); RosterData describes a COURSE
// across many students. The two are related through `payload`, which — once
// a row is drilled into — IS a full, valid BoardData, unmodified.
//
// These shapes are shared with the classroom server implementation (a
// parallel, separate piece of work) and with skills/managing-aict's
// submit.py envelope. Do not change field names/shapes here without
// reconciling both sides.

import type { BoardData } from "./types";

export interface RosterData {
  schemaVersion: number;
  // `instructorName` (from the server's COURSE_INSTRUCTOR_NAME) pre-fills the
  // comment-author field when the instructor drills into a student's board.
  // null/absent -> the field starts empty, as before.
  course: { id: string; name?: string; instructorName?: string | null };
  generatedAt: string;
  students: RosterRow[];
}

// The server still runs its mechanical re-verification on every submission
// and returns it from POST /api/submissions — submit.py prints it for the
// student. It is deliberately NOT part of the roster wire contract: the
// roster screen does not render it, so aggregating it per row was dead work.

// Mirrors IntegrityBlock["status"] in ./types.ts plus "unknown" for a
// submission the server hasn't (yet) run its mechanical pass against.
export type RosterIntegrityStatus = "passed" | "failed" | "unknown";

export interface RosterSubmissionSummary {
  submittedAt: string;
  idempotencyKey: string;
  integrityStatus: RosterIntegrityStatus;
}

export interface RosterRow {
  studentId: string;
  displayName: string;
  // null = registered but never submitted yet.
  lastSubmission: RosterSubmissionSummary | null;
  submissionCount: number;
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
