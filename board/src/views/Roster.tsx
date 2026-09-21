import { useEffect, useMemo, useState } from "react";
import App from "../App";
import type {
  RosterData,
  StudentFetchState,
  StudentSubmission,
} from "../lib/rosterTypes";

type SortKey = "name" | "submitted";
type SortDir = "asc" | "desc";

function fmtDate(iso: string): string {
  return iso.length >= 16 ? iso.slice(0, 16).replace("T", " ") : iso;
}

function sortRows(rows: RosterData["students"], key: SortKey, dir: SortDir) {
  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    if (key === "name") {
      cmp = a.displayName.localeCompare(b.displayName);
    } else {
      const at = a.lastSubmission?.submittedAt ?? "";
      const bt = b.lastSubmission?.submittedAt ?? "";
      cmp = at.localeCompare(bt);
    }
    return dir === "asc" ? cmp : -cmp;
  });
  return sorted;
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th className="px-4 py-2">
      <button
        type="button"
        className={`inline-flex items-center gap-1 font-medium ${
          active ? "text-stone-800 dark:text-stone-200" : "text-stone-500"
        }`}
        onClick={onClick}
      >
        {label}
        {active && <span aria-hidden>{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

function StudentError({
  message,
  unauthorized,
  onRetry,
}: {
  message: string;
  unauthorized?: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-10 text-center text-sm text-amber-900 dark:text-amber-200">
      <p>{message}</p>
      {unauthorized ? (
        <a
          href="/login"
          className="mt-3 inline-block rounded-md bg-stone-900 dark:bg-stone-200 px-3 py-1.5 text-xs font-medium text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400"
        >
          Log in again
        </a>
      ) : (
        <button
          type="button"
          className="mt-3 rounded-md border border-amber-400 dark:border-amber-700 px-3 py-1.5 text-xs font-medium hover:border-amber-600 dark:hover:border-amber-500"
          onClick={onRetry}
        >
          Retry
        </button>
      )}
    </div>
  );
}

type PushSummary = { sent: number; pruned: number } | null;

type SendState =
  | { phase: "idle"; releasedAt: string | null }
  | { phase: "sending" }
  | { phase: "sent"; releasedAt: string; push: PushSummary }
  | { phase: "error"; message: string };

/** "학생에게 피드백 보내기" — the only instructor action that reaches the
 * student's /me page. Posts to /api/release for the CURRENT submission's
 * shareHash. Until it is pressed, the student sees nothing; pressing it again
 * after adding more comments just refreshes the release timestamp (and
 * re-lights the student's "새 피드백" badge). */
function SendFeedbackButton({
  shareHash,
  by,
}: {
  shareHash: string;
  by?: string;
}) {
  const [state, setState] = useState<SendState>({ phase: "idle", releasedAt: null });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "idle", releasedAt: null });
    fetch(`/api/release?shareHash=${encodeURIComponent(shareHash)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j && typeof j.releasedAt === "string") {
          setState({ phase: "idle", releasedAt: j.releasedAt });
        }
      })
      .catch(() => {
        /* a missing prior-state read is not an error worth showing */
      });
    return () => {
      cancelled = true;
    };
  }, [shareHash]);

  const send = async () => {
    setState({ phase: "sending" });
    try {
      const res = await fetch("/api/release", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shareHash, by }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ phase: "error", message: j?.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({
        phase: "sent",
        releasedAt: j.releasedAt ?? new Date().toISOString(),
        push: j.push && typeof j.push.sent === "number" ? j.push : null,
      });
    } catch {
      setState({ phase: "error", message: "서버에 연결하지 못했습니다." });
    }
  };

  const already =
    (state.phase === "idle" && state.releasedAt) ||
    (state.phase === "sent" && state.releasedAt) ||
    null;

  return (
    <div className="mt-2 border-t border-stone-200 dark:border-stone-700 pt-2">
      <button
        type="button"
        disabled={state.phase === "sending"}
        className="w-full rounded-md bg-stone-900 dark:bg-stone-200 px-2.5 py-1.5 text-xs font-medium text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400 disabled:opacity-60"
        onClick={send}
      >
        {state.phase === "sending"
          ? "보내는 중…"
          : already
            ? "피드백 다시 보내기"
            : "학생에게 피드백 보내기"}
      </button>
      {state.phase === "error" && (
        <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
          보내지 못했습니다 — {state.message}
        </p>
      )}
      {already && state.phase !== "error" && (
        <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
          {state.phase === "sent" ? "보냈습니다" : "이미 보냄"} · {fmtDate(already)}
          {state.phase === "sent" && state.push && state.push.sent > 0 && (
            <> · 알림 {state.push.sent}건 전송</>
          )}
        </p>
      )}
      {!already && state.phase === "idle" && (
        <p className="mt-1 text-[11px] text-stone-400 dark:text-stone-500">
          누르기 전까지 학생에게는 아무것도 표시되지 않습니다.
        </p>
      )}
    </div>
  );
}

/** The drilled-in view: renders the EXISTING, unmodified App.tsx with one
 * submission's payload. The floating panel carries "back to roster", a
 * submission switcher, and the "학생에게 피드백 보내기" button. */
function StudentBoard({
  studentId,
  submissions,
  onBack,
  defaultReviewer,
}: {
  studentId: string;
  submissions: StudentSubmission[];
  onBack: () => void;
  defaultReviewer?: string;
}) {
  const [idx, setIdx] = useState(0);
  const sub = submissions[Math.min(idx, submissions.length - 1)] ?? null;
  // A submission's payload comes off the wire tagged mode: "submission"; the
  // roster overrides it to "hosted" so App's hosted-comment machinery (the
  // /api/comments post/fetch wiring, reviewer-name persistence) fires
  // unmodified — same reasoning as before this file was simplified.
  const boardData = useMemo(
    () =>
      sub
        ? { ...sub.payload, mode: "hosted" as const, defaultReviewer: sub.payload.defaultReviewer ?? defaultReviewer }
        : null,
    [sub, defaultReviewer],
  );

  return (
    <>
      <div className="fixed bottom-4 left-4 z-40 max-w-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 p-3 text-xs shadow-lg">
        <button
          type="button"
          className="mb-2 rounded-md border border-stone-300 dark:border-stone-600 px-2.5 py-1 text-xs font-medium text-stone-700 dark:text-stone-300 hover:border-stone-500 dark:hover:border-stone-400"
          onClick={onBack}
        >
          ← Back to roster
        </button>
        {submissions.length > 1 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {submissions.map((s, i) => (
              <button
                key={s.idempotencyKey}
                type="button"
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  i === idx
                    ? "border-stone-900 bg-stone-900 dark:bg-stone-200 text-white dark:text-stone-900"
                    : "border-stone-300 dark:border-stone-600 text-stone-600 hover:border-stone-500 dark:hover:border-stone-400"
                }`}
                onClick={() => setIdx(i)}
              >
                {fmtDate(s.submittedAt)}
              </button>
            ))}
          </div>
        )}
        {sub && (
          <SendFeedbackButton
            key={sub.idempotencyKey}
            shareHash={sub.idempotencyKey}
            by={defaultReviewer}
          />
        )}
      </div>
      {sub && boardData ? (
        <App data={boardData} />
      ) : (
        <div className="flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-950">
          <p className="text-sm text-stone-500 dark:text-stone-400">
            This student has no captured submissions yet.
          </p>
        </div>
      )}
    </>
  );
}

/** Instructor-facing roster dashboard: a sortable table of every registered
 * student's latest submission. Clicking a row fetches that student's full
 * submission history and hands the latest payload to the existing,
 * unmodified App.tsx. Deliberately minimal — name, when they last submitted,
 * and a "new" marker; the mechanical verification signals are computed and
 * logged server-side but kept off this screen. */
export default function Roster({ data }: { data: RosterData }) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ studentId: string; displayName: string } | null>(
    null,
  );
  const [studentState, setStudentState] = useState<StudentFetchState>({ status: "loading" });

  const rows = useMemo(() => {
    const sorted = sortRows(data.students, sortKey, sortDir);
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) || r.studentId.toLowerCase().includes(q),
    );
  }, [data.students, sortKey, sortDir, query]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const openStudent = async (studentId: string, displayName: string) => {
    setSelected({ studentId, displayName });
    setStudentState({ status: "loading" });
    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(studentId)}`, {
        credentials: "include",
      });
      if (res.status === 401) {
        setStudentState({
          status: "error",
          message: "Your instructor session has expired.",
          unauthorized: true,
        });
        return;
      }
      if (!res.ok) {
        setStudentState({
          status: "error",
          message: `Couldn't load this student's submissions (HTTP ${res.status}).`,
        });
        return;
      }
      const json = await res.json();
      setStudentState({ status: "ready", data: json });
    } catch {
      setStudentState({ status: "error", message: "Couldn't reach the classroom server." });
    }
  };

  const backToRoster = () => setSelected(null);

  if (selected) {
    return (
      <>
        {studentState.status === "loading" && (
          <div className="flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-950">
            <p className="text-sm text-stone-500 dark:text-stone-400">
              Loading {selected.displayName}'s submissions…
            </p>
          </div>
        )}
        {studentState.status === "error" && (
          <div className="mx-auto max-w-lg py-10">
            <StudentError
              message={studentState.message}
              unauthorized={studentState.unauthorized}
              onRetry={() => openStudent(selected.studentId, selected.displayName)}
            />
            <button
              type="button"
              className="mt-3 rounded-md border border-stone-300 dark:border-stone-600 px-3 py-1.5 text-xs font-medium text-stone-700 dark:text-stone-300 hover:border-stone-500 dark:hover:border-stone-400"
              onClick={backToRoster}
            >
              ← Back to roster
            </button>
          </div>
        )}
        {studentState.status === "ready" && (
          <StudentBoard
            studentId={selected.studentId}
            submissions={studentState.data.submissions}
            onBack={backToRoster}
            defaultReviewer={data.course.instructorName ?? undefined}
          />
        )}
      </>
    );
  }

  return (
    <div>
      {data.students.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-10 text-center text-sm text-stone-500">
          No students registered yet. Run <code>/aict:host --add-student</code> or{" "}
          <code>--roster</code> to add them.
        </div>
      ) : (
        <section className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
          <div className="border-b border-stone-200 dark:border-stone-800 p-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search students by name…"
              aria-label="Search students by name"
              className="w-full max-w-xs rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-2.5 py-1.5 text-sm outline-none focus:border-stone-500 dark:focus:border-stone-400"
            />
            {query.trim() && (
              <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">
                {rows.length} of {data.students.length}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            {rows.length === 0 ? (
              <p className="p-6 text-center text-sm text-stone-400 dark:text-stone-500">
                No student matches "{query.trim()}".
              </p>
            ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 dark:border-stone-800 text-left text-xs uppercase tracking-wide text-stone-500">
                  <SortHeader
                    label="Student"
                    active={sortKey === "name"}
                    dir={sortDir}
                    onClick={() => toggleSort("name")}
                  />
                  <SortHeader
                    label="Submission"
                    active={sortKey === "submitted"}
                    dir={sortDir}
                    onClick={() => toggleSort("submitted")}
                  />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const sub = row.lastSubmission;
                  const clickable = !!sub;
                  return (
                    <tr
                      key={row.studentId}
                      className={`border-b border-stone-100 dark:border-stone-800 last:border-0 ${
                        clickable
                          ? "cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/50"
                          : "opacity-60"
                      }`}
                      onClick={
                        clickable ? () => openStudent(row.studentId, row.displayName) : undefined
                      }
                      title={clickable ? undefined : "No submissions yet"}
                    >
                      <td className="px-4 py-2.5 font-medium text-stone-800 dark:text-stone-200">
                        {row.displayName}
                        {row.submissionCount > 1 && (
                          <span className="ml-1.5 text-[11px] font-normal text-stone-400">
                            ({row.submissionCount} submissions)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {sub ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-stone-600 dark:text-stone-400">
                              {fmtDate(sub.submittedAt)}
                            </span>
                            {row.isNewSinceLastView && (
                              <span
                                className="rounded-full border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300"
                                title="Submitted since your last visit to this dashboard"
                              >
                                new
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-stone-400 dark:text-stone-500">
                            never submitted
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
