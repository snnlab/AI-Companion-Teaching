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

  // Released submissions only, newest first — the server serves nothing else.
  const released = useMemo(
    () =>
      (mine?.submissions ?? [])
        .filter((s) => s.releasedAt)
        .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "")),
    [mine],
  );
  const current = released.find((s) => s.shareHash === key) ?? released[0] ?? null;

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
          snapshot: { submittedAt: body.submittedAt, releasedAt: body.releasedAt, comments },
        };
        if (!cancelled) setLoaded((m) => ({ ...m, [current.shareHash]: data }));
      } catch (e) {
        if (!cancelled) setLoadError(`Couldn’t load this submission (${e instanceof Error ? e.message : "error"}).`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, mine, current, loaded]);

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
        <p>No reviewed submissions yet. Your board appears here once your instructor sends feedback.</p>
        {backLink}
      </Centered>
    );
  }
  if (!board) return <Centered><p>{loadError ?? "Loading this submission…"}</p>{backLink}</Centered>;

  return (
    <>
      <div className="fixed bottom-4 left-4 z-40 max-w-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 p-3 text-xs shadow-lg">
        <a
          className="inline-block rounded-md border border-stone-300 dark:border-stone-600 px-2.5 py-1 text-xs font-medium text-stone-700 dark:text-stone-300 hover:border-stone-500"
          href="/me"
        >
          ← My feedback
        </a>
        {released.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1" aria-label="Your reviewed submissions">
            {released.map((s) => (
              <button
                key={s.shareHash}
                type="button"
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  s.shareHash === current.shareHash
                    ? "border-stone-900 bg-stone-900 dark:bg-stone-200 text-white dark:text-stone-900"
                    : "border-stone-300 dark:border-stone-600 text-stone-600 hover:border-stone-500"
                }`}
                onClick={() => setKey(s.shareHash)}
              >
                {fmtDate(s.submittedAt ?? "")}
              </button>
            ))}
          </div>
        )}
        {!shown && <p className="mt-1 text-[11px] text-stone-500">{loadError ?? "Loading this submission…"}</p>}
      </div>
      {/* key: a different submission is a different board — fresh tab/scroll state. */}
      <App key={board.shareHash} data={board} />
    </>
  );
}
