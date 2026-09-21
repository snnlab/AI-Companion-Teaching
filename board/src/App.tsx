import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Tracker from "./views/Tracker";
import PlanReader from "./views/PlanReader";
import Results from "./views/Results";
import Timeline from "./views/Timeline";
import Archive from "./views/Archive";
import Reports from "./views/Reports";
import Models from "./views/Models";
import SignOffView from "./views/SignOffView";
import ThemeToggle from "./components/ThemeToggle";
import Sidebar from "./components/Sidebar";
import { allFiles, payloadContentHash } from "./lib/parse";
import {
  buildFeedbackDocument,
  buildFeedbackMarkdown,
  feedbackFilename,
  newSessionId,
  VIEW_LABEL,
} from "./lib/feedback";
import {
  applyPostResult,
  buildCommentBody,
  getClientId,
  newUuid,
  partitionComments,
} from "./lib/hostedComments";
import { liveDraftKey, loadDrafts, clearSubmitted } from "./lib/drafts";
import { autoCloseKey, useAutoClose } from "./lib/autoClose";
import FeedbackPanel, { type SubmitState } from "./components/FeedbackPanel";
import { useHeaderOffset, useMediaQuery } from "./lib/layoutHooks";
import ConnBanner from "./components/ConnBanner";
import {
  classifyPostFailure,
  initialConn,
  reduceConn,
  shouldReload,
  POLL_MS,
  type ConnEvent,
} from "./lib/reconnect";
import {
  initialStale,
  reduceStale,
  reloadGuardHeld,
  shouldStaleReload,
  type StaleState,
} from "./lib/staleness";
import { navTargetFor, type NavTarget } from "./lib/navTarget";
import { buildFilesTree, type ActiveFileRef } from "./lib/filesTree";
import type { OutlineEntry } from "./lib/outline";
import type { ReopenRequest } from "./lib/types";
import type {
  Annotation,
  BoardData,
  DocCommentAnnotation,
  PlanCommentAnnotation,
  ReportRequest,
  ResultCommentAnnotation,
  ReviewRequest,
  ScriptCommentAnnotation,
  SeededAnnotation,
  StoredComment,
} from "./lib/types";

type Tab = "tracker" | "plans" | "results" | "timeline" | "archive" | "reports" | "models";

export const TABS: { id: Tab; label: string }[] = [
  { id: "tracker", label: "Tracker" },
  { id: "plans", label: "Analysis Plans" },
  { id: "results", label: "Output & Validation" },
  { id: "reports", label: "Reports" },
  { id: "timeline", label: "Timeline" },
  { id: "models", label: "Models" },
];

function AutoCloseNotice({
  state,
  cancel,
  enable,
}: {
  state: import("./lib/autoClose").AutoClosePhase;
  cancel: () => void;
  enable: () => void;
}) {
  if (state.phase === "counting") {
    return (
      <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
        Closing this tab in {state.remaining}s…{" "}
        <button className="underline" onClick={cancel}>
          keep open
        </button>
      </p>
    );
  }
  if (state.phase === "closeFailed") {
    return (
      <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
        Couldn't close this tab automatically — you can close it now.
      </p>
    );
  }
  if (state.phase === "cancelled") {
    return (
      <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
        Auto-close is off for this project.{" "}
        <button className="underline" onClick={enable}>
          Re-enable
        </button>
      </p>
    );
  }
  return null;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `ann-${Date.now().toString(36)}-${idCounter}`;
}

// Agent plan review (v0.9). Scope-aware identity for a seeded reviewer comment,
// used to make ingestion one-shot (see the annotations initializer): a dismissed
// seed must not re-add on reload, and reopening must never double it.
function seedDedupKey(s: SeededAnnotation): string {
  const scope = s.scope ?? "plan";
  // Plan scope keeps the original (unprefixed) key `planPath|quote|comment|author`
  // so a plan seed dismissed under Phase 1-3 stays dismissed after upgrading;
  // master/results get scope-prefixed keys that never collide with a plan path.
  if (scope === "plan") return `${s.planPath}|${s.quote}|${s.comment}|${s.author}`;
  const target =
    scope === "results" ? `${s.component}|r${s.resultsVersion}` : "master";
  return `${scope}|${target}|${s.quote}|${s.comment}|${s.author}`;
}

// Convert a reviewer seed into a pending annotation of the right type for its
// scope: plan → plan-comment, master → doc-comment (tracker), results →
// result-comment (report target). Seeds arrive unanchored (anchored:false) and
// paint in-browser at first quote match; occurrenceIndex 0 anchors the first
// match (section-aware disambiguation is a later hardening).
function seedToAnnotation(s: SeededAnnotation): Annotation {
  const scope = s.scope ?? "plan";
  if (scope === "master") {
    return {
      id: nextId(),
      type: "doc-comment",
      view: "tracker",
      docKey: "tracker",
      scope: "",
      quote: s.quote,
      prefix: "",
      suffix: "",
      sectionHeading: s.sectionHeading,
      occurrenceIndex: 0,
      anchored: false,
      comment: s.comment,
      author: s.author,
    };
  }
  if (scope === "results") {
    return {
      id: nextId(),
      type: "result-comment",
      component: s.component ?? "",
      resultsVersion: s.resultsVersion ?? 0,
      target: { kind: "report", quote: s.quote, occurrenceIndex: 0 },
      anchored: false,
      comment: s.comment,
      author: s.author,
    };
  }
  return {
    id: nextId(),
    type: "plan-comment",
    planPath: s.planPath ?? "",
    component: s.component ?? "",
    version: s.version ?? 0,
    isDraft: s.isDraft ?? false,
    quote: s.quote,
    prefix: "",
    suffix: "",
    sectionHeading: s.sectionHeading,
    scope: "",
    occurrenceIndex: 0,
    anchored: false,
    comment: s.comment,
    author: s.author,
  };
}

export default function App({ data }: { data: BoardData }) {
  if (data.sign) return <SignOffView data={data} />;

  const hosted = data.mode === "hosted";
  const canAnnotate = data.mode === "live" || data.mode === "remote" || hosted;
  const canPost = data.mode === "live";
  const remote = data.mode === "remote";
  const payloadHash = useMemo(() => payloadContentHash(allFiles(data)), [data]);
  const storageKey = `aict-board:${data.project.name}:${payloadHash}`;
  // Hosted persistence is keyed by project + board URL (stable across a
  // republish), not payloadHash — so redeploying the board never orphans a
  // visitor's unsent drafts or resets their name.
  const webKey = hosted ? `aict-hosted:${data.project.name}:${location.origin}` : null;
  // Live persistence (control surface): a STABLE per-project key so relaunches
  // with changed payloads never orphan unsent drafts. Remote keeps the
  // payload-hash scheme (one-shot files exchanged across machines).
  const liveKey = canPost && data.projectId ? liveDraftKey(data.projectId) : null;
  const pendingKey = hosted ? (webKey as string) : (liveKey ?? storageKey);
  const sessionId = useMemo(() => newSessionId(), []);

  const [tab, setTab] = useState<Tab>(
    data.focusView === "reports"
        ? "reports"
        : data.focusResults != null
          ? "results"
          : data.focus
            ? "plans"
            : "tracker",
  );
  const [selectedComponent, setSelectedComponent] = useState<string | null>(
    data.focus,
  );
  // Authoritative model profile — lifted here so it survives Models-tab
  // unmount/remount and a save patches it without a reload (frozen boot HTML).
  const [modelProfile, setModelProfile] = useState(data.modelProfile);
  const [annotations, setAnnotations] = useState<Annotation[]>(() => {
    if (!canAnnotate) return [];
    let base: Annotation[] = [];
    try {
      if (liveKey && data.projectId) {
        base = loadDrafts(localStorage, data.projectId);
      } else {
        const saved = localStorage.getItem(pendingKey);
        base = saved ? (JSON.parse(saved) as Annotation[]) : [];
      }
    } catch {
      base = [];
    }
    // Agent plan review (v0.9): reviewer comments arrive unanchored and paint
    // in-browser at first quote match (see seedToAnnotation). One-shot per board
    // session: `${pendingKey}:seeded` records which reviewer comments have already
    // been ingested, so deleting one and reloading before Send does not re-add it
    // (curation must stick), and reopening never doubles.
    let ingested: Set<string>;
    try {
      ingested = new Set(
        JSON.parse(localStorage.getItem(`${pendingKey}:seeded`) ?? "[]") as string[],
      );
    } catch {
      ingested = new Set();
    }
    const seeded: Annotation[] = (data.seededAnnotations ?? [])
      .filter((s) => !ingested.has(seedDedupKey(s)))
      .map(seedToAnnotation);
    return [...base, ...seeded];
  });
  const [drawerOpen, setDrawerOpen] = useState(
    (data.seededAnnotations?.length ?? 0) > 0,
  );
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [postFailure, setPostFailure] = useState<"server-gone" | "generic" | null>(null);
  const [closeArmed, setCloseArmed] = useState(false);
  const autoClose = useAutoClose(
    canPost && submitState === "sent" && closeArmed,
    autoCloseKey(data.projectId ?? data.project.name),
  );
  const [copyFallbackState, setCopyFallbackState] = useState<{
    text: string;
    copied: boolean | null;
  } | null>(null);
  // Reviewer name: remote persists it under the payload-hashed storageKey
  // (fine — a remote reviewer downloads one board once); hosted persists it
  // under webKey so a republish doesn't blank the name field.
  const [reviewer, setReviewer] = useState<string>(() => {
    if (!remote && !hosted) return "";
    // A name the reviewer already typed on this device wins; otherwise fall
    // back to data.defaultReviewer (hosted: the roster server's
    // COURSE_INSTRUCTOR_NAME) so the Save button is not silently disabled on
    // the very first comment. `|| `, not `?? `, so a stored empty string
    // (an earlier visit that never named itself) also takes the default.
    try {
      const stored = localStorage.getItem(hosted ? `${webKey}:name` : `${storageKey}:reviewer`);
      return (stored && stored.trim()) || data.defaultReviewer || "";
    } catch {
      return data.defaultReviewer || "";
    }
  });

  useEffect(() => {
    if (!remote && !hosted) return;
    try {
      localStorage.setItem(hosted ? `${webKey}:name` : `${storageKey}:reviewer`, reviewer);
    } catch {
      // storage unavailable — name still lives in memory
    }
  }, [reviewer, remote, hosted, webKey, storageKey]);

  // Hosted-only state: server-known comments (separate population from the
  // local pending `annotations`), a per-visitor clientId, and save feedback.
  const [serverComments, setServerComments] = useState<StoredComment[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOnce, setSavedOnce] = useState(false);
  // In-flight guard (mirrors the Publish-to-web button's publishState pattern):
  // which annotation ids currently have a Save POST in flight, so a double-click
  // or a slow response can't fire a second POST for the same annotation.
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  // Stable per-annotation comment uuid: buildCommentBody mints a fresh uuid
  // whenever the annotation id isn't UUID-shaped (board annotation ids are
  // `ann-…`, never UUID), so without this a retry after a lost response would
  // post a second blob with a different id. Reusing the same uuid makes the
  // API classify an identical create-only retry as a successful replay.
  const commentUuids = useRef<Map<string, string>>(new Map());
  const clientId = useMemo(() => (hosted ? getClientId(localStorage) : ""), [hosted]);

  useEffect(() => {
    if (!hosted) return;
    // The shareHash query param is a no-op for a single-project web-template
    // deploy (one project, one shareHash-space, ignored) and is REQUIRED for
    // the classroom roster server (many students' comments share one
    // deployment, scoped by shareHash — see classroom-template's
    // api/comments.ts). data.shareHash already exists on every hosted
    // payload; no new field needed.
    const qs = data.shareHash ? `?shareHash=${encodeURIComponent(data.shareHash)}` : "";
    fetch(`/api/comments${qs}`)
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((d) => setServerComments(d.comments ?? []))
      .catch(() => setServerComments([]));
  }, [hosted, data.shareHash]);

  const { live, stale } = hosted
    ? partitionComments(serverComments, data)
    : { live: [] as StoredComment[], stale: [] as StoredComment[] };

  async function saveHosted(a: Annotation) {
    const name = reviewer.trim();
    if (!name || savingIds.has(a.id)) return;
    setSaveError(null);
    setSavingIds((prev) => new Set(prev).add(a.id));
    // Resolve (and remember) a stable uuid for this annotation, so a double-click
    // or a retry after a lost response posts the SAME blob id — the API accepts
    // it as a replay — instead of minting a permanent duplicate comment.
    let uuid = commentUuids.current.get(a.id);
    if (!uuid) {
      uuid = newUuid();
      commentUuids.current.set(a.id, uuid);
    }
    const body = { ...buildCommentBody(a, data, name, clientId), id: uuid };
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // comment stays in `annotations` (pending) — not lost, either way
        setSaveError(
          res.status === 400
            ? "Couldn’t save — your comment may be too long. Shorten it and try again."
            : "Couldn’t save — re-enter the password; your unsent comments are kept",
        );
        return;
      }
      setAnnotations((prev) => applyPostResult(prev, a.id, true));
      setServerComments((prev) => [...prev, { ...body, receivedAt: "" }]);
      setSavedOnce(true);
    } catch {
      setSaveError("Couldn’t save — re-enter the password; your unsent comments are kept");
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(a.id);
        return next;
      });
    }
  }

  const isTouch = hosted && !!window.matchMedia?.("(pointer: coarse)")?.matches;

  // Hosted mode (the instructor drilled into a student's board): a new comment
  // posts to the server the moment it is added, so the instructor never has to
  // hunt for a second "Save" per card. The FeedbackPanel per-card Save stays as
  // a retry affordance if this POST fails or the reviewer name was still blank.
  // Refs so the add* callbacks below can stay dep-free.
  const saveHostedRef = useRef(saveHosted);
  saveHostedRef.current = saveHosted;
  const hostedRef = useRef(hosted);
  hostedRef.current = hosted;
  const autoPostHosted = useCallback((a: Annotation) => {
    if (hostedRef.current) void saveHostedRef.current(a);
  }, []);

  useEffect(() => {
    if (!canAnnotate) return;
    try {
      localStorage.setItem(pendingKey, JSON.stringify(annotations));
    } catch {
      // storage full/unavailable — annotations still live in memory
    }
  }, [annotations, canAnnotate, pendingKey]);

  // Record seeded reviewer comments as ingested (one-shot) — see the annotations
  // initializer. Runs once so a dismissed seed is not re-added on reload.
  useEffect(() => {
    const seeds = data.seededAnnotations ?? [];
    if (!canAnnotate || seeds.length === 0) return;
    try {
      const prev = new Set<string>(
        JSON.parse(localStorage.getItem(`${pendingKey}:seeded`) ?? "[]"),
      );
      for (const s of seeds) prev.add(seedDedupKey(s));
      localStorage.setItem(`${pendingKey}:seeded`, JSON.stringify([...prev]));
    } catch {
      // storage unavailable — one-shot degrades to memory only
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addPlanComment = useCallback(
    (a: Omit<PlanCommentAnnotation, "id" | "type">) => {
      const ann: Annotation = { ...a, id: nextId(), type: "plan-comment" };
      setAnnotations((prev) => [...prev, ann]);
      setDrawerOpen(true);
      autoPostHosted(ann);
    },
    [autoPostHosted],
  );

  const addResultComment = useCallback(
    (a: Omit<ResultCommentAnnotation, "id" | "type">) => {
      const ann: Annotation = { ...a, id: nextId(), type: "result-comment" };
      setAnnotations((prev) => [...prev, ann]);
      setDrawerOpen(true);
      autoPostHosted(ann);
    },
    [autoPostHosted],
  );

  const addScriptComment = useCallback(
    (a: Omit<ScriptCommentAnnotation, "id" | "type">) => {
      const ann: Annotation = { ...a, id: nextId(), type: "script-comment" };
      setAnnotations((prev) => [...prev, ann]);
      setDrawerOpen(true);
      autoPostHosted(ann);
    },
    [autoPostHosted],
  );

  const addDocComment = useCallback(
    (a: Omit<DocCommentAnnotation, "id" | "type">) => {
      const ann: Annotation = { ...a, id: nextId(), type: "doc-comment" };
      setAnnotations((prev) => [...prev, ann]);
      setDrawerOpen(true);
      autoPostHosted(ann);
    },
    [autoPostHosted],
  );

  const addGeneral = useCallback(
    (view: string, comment: string, category?: "integrity") => {
      const ann: Annotation = { id: nextId(), type: "general", view, comment, category };
      setAnnotations((prev) => [...prev, ann]);
      setDrawerOpen(true);
      autoPostHosted(ann);
    },
    [autoPostHosted],
  );

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const editAnnotation = useCallback((id: string, text: string) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, comment: text } : a)));
  }, []);

  const onPaintResult = useCallback(
    (painted: Set<string>, docKey?: string, scopeAbsent?: Set<string>) => {
      setAnnotations((prev) => {
        let changed = false;
        const next = prev.map((a) => {
          // A paint pass only covers ONE displayed document; comments on other
          // documents (other plan versions, views, results reports) must not
          // have their anchored flag clobbered by it.
          if (a.type === "plan-comment") {
            if (docKey !== undefined && a.planPath !== docKey) return a;
            const anchored = painted.has(a.id);
            if (painted.size === 0 || a.anchored === anchored) return a;
            changed = true;
            return { ...a, anchored };
          }
          if (a.type === "doc-comment") {
            if (docKey !== undefined && a.docKey !== docKey) return a;
            // Scope element hidden (e.g., timeline filter): not unanchored.
            if (scopeAbsent?.has(a.id)) return a;
            const anchored = painted.has(a.id);
            if (a.anchored === anchored) return a;
            changed = true;
            return { ...a, anchored };
          }
          if (a.type === "result-comment") {
            // Only seeded reviewer comments track anchoring (anchored defined);
            // researcher-selected ones stay untracked (no badge). Sticky-promote:
            // once painted it stays anchored, so switching bundles — where this
            // comment isn't in the pass's painted set — never clobbers it back.
            if (a.anchored === undefined) return a;
            const anchored = a.anchored || painted.has(a.id);
            if (a.anchored === anchored) return a;
            changed = true;
            return { ...a, anchored };
          }
          return a;
        });
        return changed ? next : prev;
      });
    },
    [],
  );

  const feedbackMarkdown = useMemo(
    () => buildFeedbackMarkdown(annotations),
    [annotations],
  );

  const feedbackDocument = useMemo(
    () =>
      buildFeedbackDocument(feedbackMarkdown, {
        sessionId,
        generatedAt: data.generatedAt,
        mode: data.mode,
        focus: data.focus,
        reviewer: remote ? reviewer.trim() || "anonymous reviewer" : null,
        payloadHash,
        shareHash: data.shareHash ?? null,
        annotations,
      }),
    [feedbackMarkdown, sessionId, data, remote, reviewer, payloadHash, annotations],
  );

  // Clear exactly the annotations that rode a successful POST; on the stable
  // live key unsubmitted drafts survive, elsewhere the whole key clears
  // (everything is submitted together today).
  const clearSentDrafts = (sentIds: string[]) => {
    try {
      if (liveKey && data.projectId) {
        clearSubmitted(localStorage, data.projectId, sentIds);
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // ignore
    }
  };

  const submit = async () => {
    setSubmitState("sending");
    dispatchConn({ type: "submit" });
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          annotations,
          feedbackMarkdown,
          payloadHash,
          feedbackDocument,
          boardToken: data.boardToken,
        }),
      });
      const accepted = await handleActionResponse(res);
      if (!accepted) {
        setSubmitState("idle");
        return;
      }
      setSubmitState("sent");
      setCloseArmed(true);
      clearSentDrafts(annotations.map((a) => a.id));
    } catch {
      await recoverFailedPost();
    }
  };

  // Agent plan review (v0.9): submit a review-request through the same feedback
  // channel. Any pending manual comments ride along and get routed first; the
  // session then runs the reviewer and reopens the board with its comments seeded.
  const requestReview = async (req: ReviewRequest) => {
    const md = buildFeedbackMarkdown(annotations, req);
    const doc = buildFeedbackDocument(md, {
      sessionId,
      generatedAt: data.generatedAt,
      mode: data.mode,
      focus: data.focus,
      reviewer: remote ? reviewer.trim() || "anonymous reviewer" : null,
      payloadHash,
      shareHash: data.shareHash ?? null,
      annotations,
      reviewRequest: req,
    });
    setSubmitState("sending");
    dispatchConn({ type: "submit" });
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          annotations,
          feedbackMarkdown: md,
          payloadHash,
          feedbackDocument: doc,
          reviewRequest: req,
          boardToken: data.boardToken,
        }),
      });
      const accepted = await handleActionResponse(res);
      if (!accepted) {
        setSubmitState("idle");
        return;
      }
      setSubmitState("sent");
      clearSentDrafts(annotations.map((a) => a.id));
    } catch {
      await recoverFailedPost();
    }
  };

  const download = () => {
    const blob = new Blob([feedbackDocument], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = feedbackFilename(
      data.project.name,
      remote ? reviewer : null,
      sessionId,
    );
    a.click();
    URL.revokeObjectURL(url);
    setSubmitState("downloaded");
  };


  // Generate report (v0.10): same channel and lifecycle as requestReview —
  // submit ends the board session; the session runs /aict:report
  // and offers to reopen. Pending manual comments ride along.
  const requestReport = async (req: ReportRequest) => {
    const md = buildFeedbackMarkdown(annotations, null, req);
    const doc = buildFeedbackDocument(md, {
      sessionId,
      generatedAt: data.generatedAt,
      mode: data.mode,
      focus: data.focus,
      reviewer: remote ? reviewer.trim() || "anonymous reviewer" : null,
      payloadHash,
      shareHash: data.shareHash ?? null,
      annotations,
      reportRequest: req,
    });
    setSubmitState("sending");
    dispatchConn({ type: "submit" });
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          annotations,
          feedbackMarkdown: md,
          payloadHash,
          feedbackDocument: doc,
          reportRequest: req,
          boardToken: data.boardToken,
        }),
      });
      const accepted = await handleActionResponse(res);
      if (!accepted) {
        setSubmitState("idle");
        return;
      }
      setSubmitState("sent");
      clearSentDrafts(annotations.map((a) => a.id));
    } catch {
      await recoverFailedPost();
    }
  };


  const submitReopen = async (req: ReopenRequest) => {
    const scoped = annotations.filter(
      (a) =>
        (a.type === "result-comment" || a.type === "script-comment") &&
        a.component === req.component &&
        a.resultsVersion === req.resultsVersion,
    );
    const md = buildFeedbackMarkdown(scoped, null, null, req);
    const doc = buildFeedbackDocument(md, {
      sessionId,
      generatedAt: data.generatedAt,
      mode: data.mode,
      focus: data.focus,
      reviewer: null,
      payloadHash,
      shareHash: data.shareHash ?? null,
      annotations: scoped,
      reopen: req,
    });
    setSubmitState("sending");
    dispatchConn({ type: "submit" });
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          annotations: scoped,
          feedbackMarkdown: md,
          payloadHash,
          feedbackDocument: doc,
          boardToken: data.boardToken,
        }),
      });
      const accepted = await handleActionResponse(res);
      if (!accepted) {
        setSubmitState("idle");
        return;
      }
      setSubmitState("sent");
      clearSentDrafts(scoped.map((a) => a.id));
      setAnnotations((prev) => prev.filter((a) => !scoped.includes(a)));
    } catch {
      await recoverFailedPost();
    }
  };

  const copyFallback = async () => {
    setCopyFallbackState({ text: feedbackDocument, copied: null });
    try {
      await navigator.clipboard.writeText(feedbackDocument);
      setCopyFallbackState({ text: feedbackDocument, copied: true });
    } catch {
      setCopyFallbackState({ text: feedbackDocument, copied: false });
    }
  };

  // Publish-to-web (live mode only): the local server injects a per-session
  // token as data.publishToken (sub-plan 4). Without it, there's no local
  // endpoint to post to yet — show the CLI hint instead.
  const [publishState, setPublishState] = useState<
    "idle" | "publishing" | "published" | "failed"
  >("idle");
  const publishToWeb = async () => {
    setPublishState("publishing");
    try {
      const res = await fetch("/publish-web", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.publishToken }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPublishState("published");
    } catch {
      setPublishState("failed");
    }
  };

  // ---- Reconnect (control surface, spec §4): health poll + reload machine.
  const [conn, setConn] = useState(() => initialConn(data.projectId ?? "", data.bootId ?? null));
  const connRef = useRef(conn);
  connRef.current = conn;
  const dispatchConn = (e: ConnEvent) => setConn((st) => reduceConn(st, e));
  // Content staleness (auto-refresh): the page's generation baseline is a ref
  // because a model-profile save advances it without any re-render need.
  const pageGenRef = useRef<string | null>(data.generation ?? null);
  const staleRef = useRef<StaleState>(initialStale);
  const [staleHeld, setStaleHeld] = useState(false);
  const pollBusy = useRef(false);
  // Every new send starts clean: recovery notice and (Task 5) close-arming reset.
  useEffect(() => {
    if (submitState === "sending") {
      setPostFailure(null);
      setCloseArmed(false);
    }
  }, [submitState]);
  useEffect(() => {
    if (!canPost) return;
    const t = setInterval(async () => {
      if (pollBusy.current) return; // a slow collect must not overlap polls
      pollBusy.current = true;
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (!r.ok) throw new Error("bad health");
        const h = (await r.json()) as {
          bootId: string;
          projectId: string;
          generation?: string;
        };
        if (shouldReload(connRef.current, h)) {
          location.reload();
          return;
        }
        dispatchConn({ type: "health", bootId: h.bootId,
                       projectId: h.projectId, now: Date.now() });
        staleRef.current = reduceStale(
          staleRef.current,
          h,
          { generation: pageGenRef.current, projectId: data.projectId ?? "" },
          connRef.current.phase.kind,
        );
        if (shouldStaleReload(staleRef.current)) {
          if (reloadGuardHeld(document)) {
            setStaleHeld(true);
          } else {
            location.reload();
            return;
          }
        } else {
          setStaleHeld(false);
        }
      } catch {
        dispatchConn({ type: "health-miss", now: Date.now() });
      } finally {
        pollBusy.current = false;
      }
    }, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPost]);
  const connBlocked =
    conn.phase.kind === "accepted" ||
    conn.phase.kind === "applying" ||
    conn.phase.kind === "stalled" ||
    conn.phase.kind === "sleeping";
  // Accepted/409 bookkeeping shared by every live action sender. Returns true
  // when THIS post was accepted; a 409 (slot taken / stale draft) parks the
  // client in applying — the relaunched server triggers the reload.
  const handleActionResponse = async (res: Response): Promise<boolean> => {
    if (res.ok) {
      const rb = (await res.json().catch(() => null)) as
        | { actionId?: string; bootId?: string; projectId?: string }
        | null;
      if (rb?.actionId) {
        dispatchConn({ type: "post-accepted", actionId: rb.actionId,
                       bootId: rb.bootId ?? "",
                       projectId: rb.projectId ?? (data.projectId ?? ""),
                       now: Date.now() });
      }
      return true;
    }
    if (res.status === 409) {
      const eb = (await res.json().catch(() => null)) as
        | { error?: string; actionId?: string; message?: string }
        | null;
      if (eb?.error === "pending-order") {
        showSyncNotice(
          eb.message ??
            "Route and acknowledge the existing board order before submitting another.",
        );
        dispatchConn({ type: "post-failed" });
        return false;
      }
      showSyncNotice(
        eb?.error === "stale-draft"
          ? "The plan changed on disk — the board is refreshing."
          : "The board is already applying your earlier action.",
      );
      dispatchConn({ type: "post-accepted", actionId: eb?.actionId ?? "pending",
                     bootId: "", projectId: data.projectId ?? "",
                     now: Date.now() });
      return false;
    }
    throw new Error(`HTTP ${res.status}`);
  };
  // One shared failure path (spec H2): probe health once; a new boot means the
  // tab's token is stale — reload it; a dead server gets honest copy instead
  // of a generic "failed" (the order may already be durably recorded).
  const recoverFailedPost = async () => {
    let health: { bootId: string; projectId: string } | null = null;
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      if (r.ok) health = (await r.json()) as { bootId: string; projectId: string };
    } catch {
      /* server gone */
    }
    const verdict = classifyPostFailure(connRef.current, health);
    if (verdict === "reload") {
      location.reload();
      return;
    }
    setPostFailure(verdict === "server-gone" ? "server-gone" : "generic");
    dispatchConn({ type: "post-failed" });
    setSubmitState("failed");
  };
  const guardConn = <A extends unknown[]>(fn: (...a: A) => void) =>
    (...a: A) => {
      if (connBlocked) {
        showSyncNotice("Hold on — the board is applying your previous action.");
        return;
      }
      fn(...a);
    };

  // ---- Click-sync (control surface, spec §2): card -> highlight and back.
  const navTokenRef = useRef(0);
  const [navRequest, setNavRequest] = useState<({ token: number } & NavTarget) | null>(null);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<ActiveFileRef | null>(null);
  const filesTree = useMemo(() => buildFilesTree(data), [data]);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showSyncNotice = (msg: string) => {
    setSyncNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setSyncNotice(null), 2500);
  };
  const flash = (els: Element[]) => {
    for (const el of els) {
      el.classList.remove("annot-flash");
      void (el as HTMLElement).offsetWidth; // restart the animation
      el.classList.add("annot-flash");
    }
  };
  const scrollToSelector = (selector: string, tries = 15) => {
    const attempt = (left: number) => {
      const els = Array.from(document.querySelectorAll(selector));
      if (els.length > 0) {
        (els[0] as HTMLElement).scrollIntoView({ block: "center" });
        flash(els);
        return;
      }
      if (left > 0) setTimeout(() => attempt(left - 1), 100);
    };
    requestAnimationFrame(() => requestAnimationFrame(() => attempt(tries)));
  };
  // Shared route primitive. navRequest is RETAINED state keyed by token (App
  // never clears it; views react to the token, and a remount can re-apply it).
  const applyRoute = (target: NavTarget) => {
    setTab(target.tab);
    if (target.component) setSelectedComponent(target.component);
    navTokenRef.current += 1;
    setNavRequest({ ...target, token: navTokenRef.current });
  };
  const openAnnotation = (a: Annotation) => {
    const target = navTargetFor(a, data);
    applyRoute(target);
    if (!target.anchored) {
      showSyncNotice("No highlight in this document — opened its view instead.");
      return;
    }
    scrollToSelector(`mark[data-annotation="${a.id}"], [data-annotation="${a.id}"]`);
  };
  const openReport = (slug: string, resultsVersion: number) =>
    applyRoute({ tab: "reports", component: slug, resultsVersion, annotationId: "", anchored: false });
  const openCard = (id: string) => {
    setDrawerOpen(true);
    scrollToSelector(`[data-card-id="${id}"]`);
  };
  // Highlight -> card: one document-level delegated listener covers every
  // view's marks (and ScriptViewer's line rows) without prop drilling.
  useEffect(() => {
    const resolve = (t: EventTarget | null) =>
      (t as HTMLElement | null)?.closest?.("[data-annotation]");
    const onClick = (e: MouseEvent) => {
      const mark = resolve(e.target);
      if (mark) openCard(mark.getAttribute("data-annotation") as string);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const mark = resolve(e.target);
      if (mark) openCard(mark.getAttribute("data-annotation") as string);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headerRef = useRef<HTMLElement | null>(null);
  const headerOffset = useHeaderOffset(headerRef);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isCoarse = useMediaQuery("(pointer: coarse)");
  const panelOpen = canAnnotate && drawerOpen;
  const panelProps = {
    annotations,
    serverLive: live,
    serverStale: stale,
    hosted,
    canPost,
    submitState: connBlocked && submitState !== "failed" ? ("sending" as SubmitState) : submitState,
    reviewer,
    savingIds,
    onReviewerChange: setReviewer,
    onRemove: removeAnnotation,
    onEdit: editAnnotation,
    onSaveHosted: saveHosted,
    onClose: () => setDrawerOpen(false),
    onSubmit: submit,
    onDownload: download,
    onCopyFallback: copyFallback,
    onCardClick: openAnnotation,
  };


  if (submitState === "sent" && !canPost) {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-800/50">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <div className="max-w-md rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-8 text-center shadow-sm">
          <div className="text-3xl">✓</div>
          <h1 className="mt-2 text-lg font-semibold text-stone-800 dark:text-stone-200">
            Feedback sent
          </h1>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            Return to your Claude Code session — it received your{" "}
            {annotations.length} item{annotations.length === 1 ? "" : "s"} and
            will walk through them with you.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      {copyFallbackState && (
        <div
          role="dialog"
          aria-label="Copy feedback"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 p-4 shadow-2xl"
        >
          <div className="mb-2 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                Copy feedback
              </h2>
              <p className="text-xs text-stone-600 dark:text-stone-400">
                {copyFallbackState.copied
                  ? "Copied. Paste this into your Claude Code session."
                  : "Select the feedback below and copy it into your Claude Code session."}
              </p>
            </div>
            <button
              className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
              onClick={() => setCopyFallbackState(null)}
            >
              Close
            </button>
          </div>
          <textarea
            aria-label="Feedback markdown"
            className="h-40 w-full resize-y rounded border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 p-2 font-mono text-xs text-stone-800 dark:text-stone-200"
            readOnly
            value={copyFallbackState.text}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}
      {syncNotice && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-3 py-1.5 text-xs text-stone-700 dark:text-stone-200 shadow-lg">
          {syncNotice}
        </div>
      )}
      {canPost && staleHeld && (
        <div className="fixed bottom-12 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-3 py-1.5 text-xs text-stone-700 dark:text-stone-200 shadow-lg">
          <span>Plans changed on disk. The board will refresh when you finish.</span>
          <button
            className="rounded bg-stone-900 dark:bg-stone-200 px-2 py-0.5 text-[11px] font-medium text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-400"
            onClick={() => location.reload()}
          >
            Refresh now
          </button>
        </div>
      )}
      {canPost && submitState === "sent" && closeArmed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-50/95 dark:bg-stone-900/95">
          <div className="max-w-md rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-8 text-center shadow-sm">
            <div className="text-3xl">✓</div>
            <h1 className="mt-2 text-lg font-semibold text-stone-800 dark:text-stone-200">
              Sent — your session is applying it
            </h1>
            <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
              This action closes the board; run /aict:board to reopen
              it later.
            </p>
            <AutoCloseNotice state={autoClose.state} cancel={autoClose.cancel} enable={autoClose.enable} />
          </div>
        </div>
      )}
      <header ref={headerRef} className="sticky top-0 z-30 border-b border-stone-200 dark:border-stone-800 bg-white/90 dark:bg-stone-900/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-4 px-5 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-stone-900 dark:text-stone-100">
              {data.project.name}
            </div>
            <div className="text-[11px] text-stone-400 dark:text-stone-500">
              aict · generated {data.generatedAt.slice(0, 16)}
              {data.git.available && data.git.head ? ` · ${data.git.head}` : ""}
            </div>
          </div>
          <nav
            aria-label="Board views"
            className="order-3 flex w-full flex-wrap gap-1 lg:order-none lg:ml-4 lg:w-auto"
          >
            {(data.files.archives?.length
              ? [...TABS, { id: "archive" as Tab, label: "Archive" }]
              : TABS
            )
              // A focused collaborator share omits the model profile (whole-project
              // config), so hide the Models tab there — it would otherwise claim
              // "no profile" for a project that has one.
              .filter((t) => !(t.id === "models" && data.mode === "remote" && data.focus))
              .map((t) => (
              <button
                key={t.id}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  tab === t.id
                    ? "bg-stone-900 dark:bg-stone-200 text-white dark:text-stone-900"
                    : "text-stone-600 hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {canPost &&
              (data.publishToken ? (
                <button
                  className="rounded-md border border-stone-300 dark:border-stone-600 px-3 py-1.5 text-sm font-medium text-stone-700 dark:text-stone-300 hover:border-stone-500 dark:hover:border-stone-400 disabled:opacity-40"
                  disabled={publishState === "publishing"}
                  onClick={publishToWeb}
                >
                  {publishState === "publishing"
                    ? "Publishing…"
                    : publishState === "published"
                      ? "Published"
                      : publishState === "failed"
                        ? "Publish failed — retry"
                        : "Publish to web"}
                </button>
              ) : (
                <span className="text-[11px] text-stone-400 dark:text-stone-500">
                  Run /aict:board --publish-web in Claude Code
                </span>
              ))}
            {canAnnotate && (
              <button
                className="rounded-md border border-stone-300 dark:border-stone-600 px-3 py-1.5 text-sm font-medium text-stone-700 dark:text-stone-300 hover:border-stone-500 dark:hover:border-stone-400"
                onClick={() => setDrawerOpen((o) => !o)}
              >
                Feedback ({annotations.length})
              </button>
            )}
          </div>
        </div>
        {data.mode === "static" && (
          <div className="border-t border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-5 py-1.5 text-center text-xs text-amber-900 dark:text-amber-200">
            Read-only snapshot generated {data.generatedAt.slice(0, 16)}
            {data.git.available && data.git.head
              ? ` at commit ${data.git.head}`
              : ""}{" "}
            — regenerate with /aict:board --export
          </div>
        )}
        {remote && (
          <div className="border-t border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950 px-5 py-2 text-xs leading-relaxed text-blue-900 dark:text-blue-200">
            <span className="font-medium">
              You’ve been asked to review this student’s analysis plan.
            </span>{" "}
            Select text in any view to attach a comment — plans, tracker rows,
            timeline entries, results, and reports all take them.
            When you’re done, open Feedback and press
            “Download feedback file”, then email the downloaded file back to
            the student. Don’t move or rename this HTML file until you’ve
            downloaded your feedback — your comments are saved by this browser
            against this file’s location.
          </div>
        )}
        {hosted && saveError && (
          <div className="border-t border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 px-5 py-1.5 text-center text-xs text-red-800 dark:text-red-300">
            {saveError}
          </div>
        )}
        {hosted && savedOnce && !saveError && (
          <div className="border-t border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950 px-5 py-1.5 text-center text-xs text-green-800 dark:text-green-300">
            Sent — visible to everyone with this link; the student picks up
            comments in Claude Code
          </div>
        )}
        {isTouch && (
          <div className="border-t border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950 px-5 py-1.5 text-center text-xs text-blue-900 dark:text-blue-200">
            Reading works here; commenting works best on a computer
          </div>
        )}
        {canPost && <ConnBanner phase={conn.phase} />}
        {canPost && postFailure === "server-gone" && (
          <div className="border-t border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-5 py-1.5 text-center text-xs text-amber-800 dark:text-amber-300">
            The board server isn't running — your submission may already have
            reached your session; otherwise reopen with /aict:board.
          </div>
        )}
      </header>

      <div className="mx-auto flex w-full max-w-[1440px]">
        <main className="min-w-0 flex-1 px-5 py-6">
          <div className="mx-auto max-w-5xl">
        <div data-testid="board-content-layout" className="flex flex-col gap-5 lg:flex-row">
          <Sidebar
            outline={outline}
            tree={filesTree}
            onNavigate={applyRoute}
            activeId={activeFile?.id ?? null}
            activeLabel={activeFile?.label ?? null}
            activeOutlineId={activeOutlineId}
            storageKey={`aict-sidebar:${data.projectId ?? data.project.name}`}
            defaultCollapsed={isCoarse}
            topOffsetPx={headerOffset}
          />
          <div className="min-w-0 flex-1">
        {tab === "tracker" && (
          <Tracker
            data={data}
            canAnnotate={canAnnotate}
            annotations={annotations}
            onAddDocComment={addDocComment}
            onPaintResult={onPaintResult}
            onAddGeneral={addGeneral}
            onOpenComponent={(slug) => {
              setSelectedComponent(slug);
              setTab("plans");
            }}
            onOpenResults={(slug) => {
              setSelectedComponent(slug);
              setTab("results");
            }}
            onRequestReview={guardConn(requestReview)}
            onOpenArchive={
              data.files.archives?.length ? () => setTab("archive") : undefined
            }
            onOpenReport={openReport}
            onOutline={setOutline}
            onActiveFile={setActiveFile}
          />
        )}
        {tab === "plans" && (
          <PlanReader
            data={data}
            navRequest={navRequest?.tab === "plans" ? { token: navRequest.token, planPath: navRequest.planPath } : null}
            canAnnotate={canAnnotate}
            selectedComponent={selectedComponent}
            annotations={annotations}
            onAddPlanComment={addPlanComment}
            onPaintResult={onPaintResult}
            onOpenResults={(slug) => {
              setSelectedComponent(slug);
              setTab("results");
            }}
            onRequestReview={guardConn(requestReview)}
            onOpenReport={openReport}
            onOutline={setOutline}
            onActiveOutline={setActiveOutlineId}
            onActiveFile={setActiveFile}
          />
        )}
        {tab === "results" && (
          <Results
            data={data}
            onReopen={guardConn(submitReopen)}
            navRequest={navRequest?.tab === "results" ? { token: navRequest.token, resultsVersion: navRequest.resultsVersion, scriptPath: navRequest.scriptPath } : null}
            canAnnotate={canAnnotate}
            selectedComponent={selectedComponent}
            annotations={annotations}
            onAddResultComment={addResultComment}
            onAddScriptComment={addScriptComment}
            onPaintResult={onPaintResult}
            focusResults={data.focusResults ?? null}
            onRequestReview={guardConn(requestReview)}
            onRequestReport={guardConn(requestReport)}
            onOutline={setOutline}
            onActiveFile={setActiveFile}
          />
        )}
        {tab === "archive" && (
          <Archive
            data={data}
            navRequest={navRequest?.tab === "archive" ? { token: navRequest.token, archivePath: navRequest.archivePath } : null}
            canAnnotate={canAnnotate}
            annotations={annotations}
            onAddDocComment={addDocComment}
            onPaintResult={onPaintResult}
            onAddGeneral={addGeneral}
            onOpenComponent={(slug) => {
              setSelectedComponent(slug);
              setTab("plans");
            }}
            onOpenResults={(slug) => {
              setSelectedComponent(slug);
              setTab("results");
            }}
            onOpenReport={openReport}
            onOutline={setOutline}
          />
        )}
        {tab === "reports" && (
          <Reports
            data={data}
            canAnnotate={canAnnotate}
            selectedComponent={selectedComponent}
            annotations={annotations}
            onAddDocComment={addDocComment}
            onPaintResult={onPaintResult}
            onRequestReport={guardConn(requestReport)}
            focusResults={data.focusView === "reports" ? (data.focusResults ?? null) : null}
            navRequest={
              navRequest?.tab === "reports"
                ? { token: navRequest.token, resultsVersion: navRequest.resultsVersion }
                : null
            }
            onOutline={setOutline}
            onActiveOutline={setActiveOutlineId}
            onActiveFile={setActiveFile}
          />
        )}
        {tab === "models" && (
          <Models
            data={data}
            modelProfile={modelProfile}
            onProfileChange={setModelProfile}
            onOutline={setOutline}
            onPayloadGeneration={(g) => {
              pageGenRef.current = g;
              staleRef.current = initialStale;
              setStaleHeld(false);
            }}
          />
        )}
        {tab === "timeline" && (
          <Timeline
            data={data}
            navRequest={navRequest?.tab === "timeline" ? { token: navRequest.token, clearFilter: navRequest.clearTimelineFilter } : null}
            canAnnotate={canAnnotate}
            annotations={annotations}
            onAddDocComment={addDocComment}
            onPaintResult={onPaintResult}
            onAddGeneral={addGeneral}
            onOutline={setOutline}
            onActiveFile={setActiveFile}
          />
        )}
          </div>
        </div>
          </div>
        </main>
        {panelOpen && isDesktop && (
          <FeedbackPanel
            variant="docked"
            style={{ top: headerOffset, height: `calc(100vh - ${headerOffset}px)` }}
            {...panelProps}
          />
        )}
      </div>

      {panelOpen && !isDesktop && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/30"
            onClick={() => setDrawerOpen(false)}
          />
          <FeedbackPanel variant="overlay" {...panelProps} />
        </>
      )}
    </div>
  );
}
