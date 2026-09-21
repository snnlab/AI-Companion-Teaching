import { useCallback, useEffect, useMemo, useState } from "react";
import AnnotationLayer, { type AnchoredSelection } from "../components/AnnotationLayer";
import ConnBanner from "../components/ConnBanner";
import DiffView from "../components/DiffView";
import PlanBody from "../components/PlanBody";
import ScorePanel from "../components/ScorePanel";
import ThemeToggle from "../components/ThemeToggle";
import { parseExecutionPlan, parseScorecard } from "../lib/parse";
import {
  classifyPostFailure,
  initialConn,
  POLL_MS,
  shouldReload,
} from "../lib/reconnect";
import type {
  BoardData,
  PlanCommentAnnotation,
} from "../lib/types";

type Decision = "pending" | "approved" | "changes" | "ticketed";

const decisionLabel = (decision: Decision): string => {
  if (decision === "approved") return "approved ✓";
  if (decision === "changes") return "changes requested ✕";
  if (decision === "ticketed") return "ticket already saved ✓";
  return "pending";
};

export default function SignOffView({ data }: { data: BoardData }) {
  const sign = data.sign!;
  const [selected, setSelected] = useState(0);
  const [decisions, setDecisions] = useState<Decision[]>(() =>
    sign.items.map((item) => (item.ticketed ? "ticketed" : "pending")),
  );
  const [annotations, setAnnotations] = useState<PlanCommentAnnotation[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [donePosted, setDonePosted] = useState(false);
  const [serverGone, setServerGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conn = useMemo(
    () => initialConn(data.projectId ?? "", data.bootId ?? null),
    [data.projectId, data.bootId],
  );

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        if (!response.ok) return;
        const health = await response.json() as { bootId: string; projectId: string };
        if (shouldReload(conn, health)) window.location.reload();
      } catch {
        // The one-shot server exits after a hook decision; that is expected.
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [conn]);

  const post = useCallback(async (path: string, body: object) => {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, boardToken: data.boardToken }),
    });
    const responseBody = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { response, responseBody };
  }, [data.boardToken]);

  const recoverPostFailure = useCallback(async (fallback: string) => {
    let health: { bootId: string; projectId: string } | null = null;
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (response.ok) health = await response.json();
    } catch {
      // Classified as server-gone below.
    }
    const recovery = classifyPostFailure(conn, health);
    if (recovery === "reload") {
      window.location.reload();
    } else if (recovery === "server-gone") {
      setServerGone(true);
    } else {
      setError(fallback);
    }
  }, [conn]);

  const allDecided = decisions.every((decision) => decision !== "pending");
  useEffect(() => {
    if (sign.transport !== "ticket" || !allDecided || donePosted) return;
    setDonePosted(true);
    void post("/api/sign/done", {}).then(({ response }) => {
      if (!response.ok) void recoverPostFailure("Could not close the sign session.");
    }).catch(() => recoverPostFailure("Could not close the sign session."));
  }, [allDecided, donePosted, post, recoverPostFailure, sign.transport]);

  const item = sign.items[selected];
  const itemAnnotations = annotations.filter((annotation) => annotation.planPath === item.path);
  const parsed = parseExecutionPlan(item.content);
  const group = data.files.executionPlans.find((entry) => entry.component === item.component);
  const previous = group?.versions
    .filter((version) => version.version < item.proposedVersion)
    .at(-1) ?? null;
  const [showDiff, setShowDiff] = useState(false);
  useEffect(() => setShowDiff(false), [item.path]);

  const scorecard = useMemo(() => {
    const matches = data.files.reviews
      .map((review) => parseScorecard(review.content))
      .filter((score) => score?.planPath === item.path);
    return matches.length === 1 ? matches[0] : null;
  }, [data.files.reviews, item.path]);

  const markDecision = (decision: Decision) => {
    setDecisions((current) => current.map((value, index) =>
      index === selected ? decision : value));
    const next = decisions.findIndex((value, index) => index !== selected && value === "pending");
    if (next >= 0) setSelected(next);
  };

  const approve = async () => {
    if (itemAnnotations.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const path = sign.transport === "ticket" ? "/api/sign/approve" : "/api/approve";
      const body = sign.transport === "ticket"
        ? {
            component: item.component,
            proposedVersion: item.proposedVersion,
            contentHash: item.contentHash,
          }
        : {};
      const { response, responseBody } = await post(path, body);
      if (!response.ok) {
        await recoverPostFailure(
          `Approval failed (${String(responseBody.error ?? response.status)}).`,
        );
        return;
      }
      markDecision("approved");
    } catch {
      await recoverPostFailure("Approval failed. Run /aict:sign to resume.");
    } finally {
      setBusy(false);
    }
  };

  const requestChanges = async () => {
    setBusy(true);
    setError(null);
    const note = notes[item.path] ?? "";
    try {
      const path = sign.transport === "ticket" ? "/api/sign/reject" : "/api/deny";
      const body = sign.transport === "ticket"
        ? {
            component: item.component,
            version: item.proposedVersion,
            note,
            annotations: itemAnnotations,
          }
        : {
            annotations: itemAnnotations,
            feedbackMarkdown: note || "# Sign feedback\n\nChanges requested.",
            feedbackDocument: note || "# Sign feedback\n\nChanges requested.",
            payloadHash: item.contentHash,
          };
      const { response, responseBody } = await post(path, body);
      if (!response.ok) {
        await recoverPostFailure(
          `Change request failed (${String(responseBody.error ?? response.status)}).`,
        );
        return;
      }
      markDecision("changes");
    } catch {
      await recoverPostFailure("Change request failed. Run /aict:sign to resume.");
    } finally {
      setBusy(false);
    }
  };

  const addAnnotation = (selection: AnchoredSelection) => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `sign-${Date.now()}-${annotations.length}`;
    setAnnotations((current) => [...current, {
      id,
      type: "plan-comment",
      planPath: item.path,
      component: item.component,
      version: item.proposedVersion,
      isDraft: true,
      ...selection,
    }]);
  };
  const onPaintResult = useCallback(() => {}, []);

  if (allDecided) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <h1 className="text-xl font-semibold text-stone-800 dark:text-stone-200">
          {sign.transport === "ticket" ? "Sign-off decisions saved" : "Sign decision sent"}
        </h1>
        <div className="mt-5 space-y-2 text-sm text-stone-600 dark:text-stone-400">
          {sign.items.map((entry, index) => (
            <div key={entry.path}>
              {entry.component} · v{entry.proposedVersion}: {" "}
              <span>{decisionLabel(decisions[index])}</span>
            </div>
          ))}
        </div>
        {serverGone && (
          <ConnBanner phase={{ kind: "sleeping", lastBootId: data.bootId ?? null }} signSessionEnded />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <header className="border-b border-stone-200 bg-white px-5 py-3 dark:border-stone-800 dark:bg-stone-900">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <h1 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
            {sign.items.length === 1 ? "Sign plan" : "Sign plans"}
          </h1>
          <span className="text-xs text-stone-500">
            {sign.transport === "hook" ? "execution gate" : "ticket session"}
          </span>
          <div className="ml-auto"><ThemeToggle /></div>
        </div>
        {serverGone && (
          <ConnBanner phase={{ kind: "sleeping", lastBootId: data.bootId ?? null }} signSessionEnded />
        )}
      </header>
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5 md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="space-y-2">
          {sign.items.map((entry, index) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => setSelected(index)}
              className={`w-full rounded-lg border p-3 text-left ${
                index === selected
                  ? "border-stone-700 bg-white dark:border-stone-300 dark:bg-stone-900"
                  : "border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900/50"
              }`}
            >
              <span className="block text-sm font-semibold">{entry.component} · v{entry.proposedVersion}</span>
              <span className="mt-1 block text-[11px] text-stone-500">{decisionLabel(decisions[index])}</span>
            </button>
          ))}
        </aside>
        <main className="min-w-0">
          <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="font-semibold">{item.component} · proposed v{item.proposedVersion}</span>
              {scorecard && <ScorePanel scorecard={scorecard} />}
              {previous && (
                <button
                  type="button"
                  className="ml-auto rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
                  onClick={() => setShowDiff((value) => !value)}
                >
                  {showDiff ? "Read plan" : `Diff vs v${previous.version}`}
                </button>
              )}
            </div>
            {showDiff && previous ? (
              <DiffView before={previous.content} after={item.content} supersedesReason={parsed.supersedes} />
            ) : (
              <AnnotationLayer
                docKey={item.path}
                annotations={itemAnnotations}
                onAdd={addAnnotation}
                onPaintResult={onPaintResult}
              >
                <PlanBody
                  content={item.content}
                  level={data.detailLevel ?? "standard"}
                  stripMetadata={false}
                />
              </AnnotationLayer>
            )}
          </div>
          {itemAnnotations.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950">
              {itemAnnotations.map((annotation) => (
                <div key={annotation.id} className="flex items-start gap-2 py-1">
                  <span className="min-w-0 flex-1">“{annotation.quote}” — {annotation.comment}</span>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setAnnotations((current) =>
                      current.filter((entry) => entry.id !== annotation.id))}
                  >
                    delete
                  </button>
                </div>
              ))}
            </div>
          )}
          {error && <p className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>}
          <textarea
            value={notes[item.path] ?? ""}
            onChange={(event) => setNotes((current) => ({
              ...current, [item.path]: event.target.value,
            }))}
            placeholder="Optional note for a change request…"
            className="mt-4 h-20 w-full rounded-md border border-stone-300 p-2 text-sm dark:border-stone-700"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={requestChanges}
              disabled={busy || decisions[selected] !== "pending"}
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-40 dark:border-red-800 dark:text-red-300"
            >
              Request changes
            </button>
            <button
              type="button"
              onClick={approve}
              disabled={busy || decisions[selected] !== "pending" || itemAnnotations.length > 0}
              title={itemAnnotations.length > 0 ? "Delete or send every pending annotation on this item first" : undefined}
              className="rounded-md bg-green-700 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Approve
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
