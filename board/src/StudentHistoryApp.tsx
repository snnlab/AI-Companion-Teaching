// The student's history board (/me/board on the classroom server): one of
// their own past submissions, read-only, with the instructor's released
// comments painted in place — the same board the instructor reviewed.
//
// Signs in exactly like /me: the student's submission token, remembered in
// this browser under the same key me.html uses, sent as a bearer token to the
// student-only routes (/api/my-comments, /api/my-submission, /api/assets).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import App from "./App";
import type { BoardData, StoredComment } from "./lib/types";
import { hydrateExternalAssets, type FetchPart } from "./lib/externalAssets";
import { fmtDate } from "./lib/fmtDate";

export const ME_TOKEN_KEY = "aict-me-token"; // shared with me.html

interface MySubmission {
  shareHash: string;
  submittedAt: string | null;
  releasedAt: string | null;
}

interface MyComments {
  studentId: string;
  comments: StoredComment[];
  submissions: MySubmission[];
}

function readToken(): string | null {
  try {
    return localStorage.getItem(ME_TOKEN_KEY);
  } catch {
    return null;
  }
}

function bearerFetchPart(token: string): FetchPart {
  return async (sha, part) => {
    const qs = new URLSearchParams({ sha, part: String(part) });
    const res = await fetch(`/api/assets?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`asset ${sha} part ${part}: HTTP ${res.status}`);
    return res.arrayBuffer();
  };
}

const when = (s: MySubmission) => {
  const t = Date.parse(s.submittedAt ?? "");
  return Number.isNaN(t) ? 0 : t;
};

// Version N = the submission's place among ALL of the student's submissions,
// oldest = 1 — the same numbering /me and /ait:check --history use, so a
// version keeps its number as new ones arrive.
export function versionNumbers(subs: MySubmission[]): Record<string, number> {
  const out: Record<string, number> = {};
  [...subs].sort((a, b) => when(a) - when(b)).forEach((s, i) => {
    out[s.shareHash] = i + 1;
  });
  return out;
}

// The notification lands students here, so re-register this browser's push
// subscription with the server quietly, as /me does. The server drops a
// subscription the push service reported gone; this restores it. Best-effort.
async function refreshPushSubscription(token: string): Promise<void> {
  if (!("serviceWorker" in navigator) || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await fetch("/api/push-subscribe", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-950 px-4">
      <div className="max-w-md rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-8 text-center text-sm text-stone-600 dark:text-stone-300 shadow-sm">
        {children}
      </div>
    </div>
  );
}

const backLink = (
  <a className="mt-4 inline-block text-blue-600 underline dark:text-blue-400" href="/me">
    Back to My feedback
  </a>
);

export default function StudentHistoryApp() {
  const token = useMemo(readToken, []);
  const [mine, setMine] = useState<MyComments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(
    () => new URLSearchParams(location.search).get("key"),
  );
  const [loaded, setLoaded] = useState<Record<string, BoardData>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch("/api/my-comments", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (r.status === 401) throw new Error("token");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setMine((await r.json()) as MyComments);
      })
      .catch((e: Error) =>
        setError(
          e.message === "token"
            ? "Your token was not accepted. Enter it again on the My feedback page."
            : "Couldn’t reach the server. Try again in a moment.",
        ),
      );
  }, [token]);

  useEffect(() => {
    if (token) refreshPushSubscription(token).catch(() => {});
  }, [token]);

  const numbers = useMemo(() => versionNumbers(mine?.submissions ?? []), [mine]);
  const total = mine?.submissions.length ?? 0;
  // Released submissions only, newest first — the server serves nothing else.
  const released = useMemo(
    () => (mine?.submissions ?? []).filter((s) => s.releasedAt).sort((a, b) => when(b) - when(a)),
    [mine],
  );
  const current = released.find((s) => s.shareHash === key) ?? released[0] ?? null;
  const currentIndex = current ? released.indexOf(current) : -1;

  // Keep the address bar on the submission shown, so a reload or a shared
  // bookmark reopens the same one.
  useEffect(() => {
    if (!current) return;
    const url = new URL(location.href);
    if (url.searchParams.get("key") !== current.shareHash) {
      url.searchParams.set("key", current.shareHash);
      history.replaceState(null, "", url);
    }
  }, [current]);

  useEffect(() => {
    if (!token || !mine || !current || loaded[current.shareHash]) return;
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const qs = new URLSearchParams({ key: current.shareHash });
        const res = await fetch(`/api/my-submission?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { payload: BoardData; submittedAt: string; releasedAt: string | null };
        const hydrated = await hydrateExternalAssets(body.payload, mine.studentId, bearerFetchPart(token));
        const comments = mine.comments.filter((c) => c.shareHash === current.shareHash);
        const data: BoardData = {
          ...hydrated,
          mode: "snapshot",
          shareHash: current.shareHash,
          snapshot: {
            submittedAt: body.submittedAt,
            releasedAt: body.releasedAt,
            comments,
            version: numbers[current.shareHash],
          },
        };
        if (!cancelled) setLoaded((m) => ({ ...m, [current.shareHash]: data }));
      } catch (e) {
        if (!cancelled) setLoadError(`Couldn’t load this submission (${e instanceof Error ? e.message : "error"}).`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, mine, current, loaded, numbers]);

  // While switching, keep the previous board mounted (same as the roster).
  const lastShown = useRef<BoardData | null>(null);
  const shown = current ? loaded[current.shareHash] : undefined;
  if (shown) lastShown.current = shown;
  const board = shown ?? lastShown.current;

  if (!token) {
    return (
      <Centered>
        <p>Open My feedback first and enter your submission token — this page uses the same one.</p>
        {backLink}
      </Centered>
    );
  }
  if (error) return <Centered><p>{error}</p>{backLink}</Centered>;
  if (!mine) return <Centered><p>Loading…</p></Centered>;
  if (!current) {
    return (
      <Centered>
        <p>No reviewed versions yet. A version opens here once your instructor sends feedback on it.</p>
        {backLink}
      </Centered>
    );
  }
  if (!board) return <Centered><p>{loadError ?? "Loading this submission…"}</p>{backLink}</Centered>;

  return (
    <>
      <nav
        className="fixed bottom-4 left-4 z-40 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 p-3 text-xs shadow-lg"
        aria-label="Your reviewed versions"
      >
        <a
          className="inline-block rounded-md border border-stone-300 dark:border-stone-600 px-2.5 py-1 text-xs font-medium text-stone-700 dark:text-stone-300 hover:border-stone-500"
          href="/me"
        >
          ← My feedback
        </a>
        <p className="mt-2 text-sm font-semibold text-stone-900 dark:text-stone-100" data-testid="version-heading">
          Version {numbers[current.shareHash]} of {total}
        </p>
        <p className="text-[11px] text-stone-500 dark:text-stone-400">
          submitted {fmtDate(current.submittedAt ?? "")}
          {current.releasedAt ? ` · reviewed ${fmtDate(current.releasedAt)}` : ""}
        </p>
        {released.length > 1 && (
          <div className="mt-2 flex items-center gap-1">
            <button
              type="button"
              className="rounded-md border border-stone-300 dark:border-stone-600 px-2 py-1 font-medium text-stone-700 dark:text-stone-300 enabled:hover:border-stone-500 disabled:opacity-40"
              disabled={currentIndex >= released.length - 1}
              onClick={() => setKey(released[currentIndex + 1].shareHash)}
              title="Older reviewed version"
            >
              ← Older
            </button>
            <select
              className="min-w-0 flex-1 rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-1 py-1 text-xs"
              aria-label="Reviewed version"
              value={current.shareHash}
              onChange={(e) => setKey(e.target.value)}
            >
              {released.map((s) => (
                <option key={s.shareHash} value={s.shareHash}>
                  Version {numbers[s.shareHash]} · {fmtDate(s.submittedAt ?? "").slice(5, 10)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-md border border-stone-300 dark:border-stone-600 px-2 py-1 font-medium text-stone-700 dark:text-stone-300 enabled:hover:border-stone-500 disabled:opacity-40"
              disabled={currentIndex <= 0}
              onClick={() => setKey(released[currentIndex - 1].shareHash)}
              title="Newer reviewed version"
            >
              Newer →
            </button>
          </div>
        )}
        {total > released.length && (
          <p className="mt-2 text-[11px] text-stone-500 dark:text-stone-400">
            {total - released.length} version{total - released.length === 1 ? " is" : "s are"} waiting for
            review — {total - released.length === 1 ? "it opens" : "they open"} here once feedback is sent.
          </p>
        )}
        {!shown && <p className="mt-1 text-[11px] text-stone-500">{loadError ?? "Loading this version…"}</p>}
      </nav>
      {/* key: a different submission is a different board — fresh tab/scroll state. */}
      <App key={board.shareHash} data={board} />
    </>
  );
}
