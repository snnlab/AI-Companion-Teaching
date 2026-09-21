import { useEffect, useMemo, useState } from "react";
import { Marked } from "marked";
import Markdown from "./Markdown";
import { METHOD_SECTIONS } from "../lib/parse";

// Metadata preamble lines render as a card and are stripped from the prose so
// they don't render twice. The H1 title is KEPT (it is the plan's only
// human-readable title). Anything else in the preamble still renders below
// the card. Annotations on metadata lines unanchor by design (ruled v0.21).
const METADATA_LINE_RE =
  /^(?:Component:.*|Master plan:.*|Date:.*|Provenance:.*|Supersedes:.*)$/;
export function stripPreambleMetadata(body: string): string {
  return body
    .split("\n")
    .filter((ln) => !METADATA_LINE_RE.test(ln.trim()))
    .join("\n")
    .trim();
}
// Build steps render as a numbered card spine (spec R2). Boundaries come from
// marked's lexer (structural, never regex). Each item re-renders through
// BodyParts so agent-detail keeps working; reference-link definitions from the
// whole body are appended so cross-item links survive; GFM task state renders
// in the card chrome (marked strips it from item.text). CRLF is normalized
// up front — marked normalizes internally, which would break raw indexing.
// Semantic <ol>/<li> so assistive tech still announces an ordered list.
const stepLexer = new Marked({ gfm: true });
const LINK_DEF_RE = /^\[[^\]]+\]:\s+\S.*$/gm;

interface StepItem { text: string; task: boolean; checked: boolean }

export function splitBuildSteps(
  rawBody: string,
): { before: string; items: StepItem[]; after: string } | null {
  const body = rawBody.replace(/\r\n/g, "\n");
  const tokens = stepLexer.lexer(body);
  const list = tokens.find(
    (t) => t.type === "list" && (t as { ordered?: boolean }).ordered,
  ) as { raw: string; items: Array<{ text: string; task: boolean; checked?: boolean }> } | undefined;
  if (!list) return null;
  const start = body.indexOf(list.raw);
  if (start === -1) return null;
  const defs = (body.match(LINK_DEF_RE) ?? []).join("\n");
  return {
    before: body.slice(0, start).trim(),
    items: list.items.map((it) => ({
      text: defs ? `${it.text}\n\n${defs}` : it.text,
      task: it.task,
      checked: Boolean(it.checked),
    })),
    after: body.slice(start + list.raw.length).trim(),
  };
}

function StepCards({ body, detailOpen }: { body: string; detailOpen: boolean }) {
  const split = useMemo(() => splitBuildSteps(body), [body]);
  if (!split) return <BodyParts source={body} detailOpen={detailOpen} />;
  return (
    <>
      {split.before && <BodyParts source={split.before} detailOpen={detailOpen} />}
      <ol className="ml-0 list-none">
        {split.items.map((it, i) => (
          <li
            key={i}
            className="my-3 rounded-lg border border-stone-200 p-4 dark:border-stone-700"
          >
            <div
              className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--aict-prose-muted)" }}
            >
              Step {i + 1} of {split.items.length}
              {it.task && (
                <input type="checkbox" disabled checked={it.checked} className="accent-green-600" />
              )}
            </div>
            <BodyParts source={it.text} detailOpen={detailOpen} />
          </li>
        ))}
      </ol>
      {split.after && <BodyParts source={split.after} detailOpen={detailOpen} />}
    </>
  );
}

type DetailLevel = "compact" | "standard" | "full";

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Split a plan into sections on `## ` headings. The chunk before the first
// heading is returned with heading=null. The body excludes the heading line.
function splitSections(content: string): { heading: string | null; body: string }[] {
  const out: { heading: string | null; body: string }[] = [];
  let heading: string | null = null;
  let body: string[] = [];
  const flush = () => {
    const b = body.join("\n");
    if (heading !== null || b.trim()) out.push({ heading, body: b });
  };
  for (const line of content.split("\n")) {
    const m = /^## (.+?)\s*$/.exec(line);
    if (m) {
      flush();
      heading = m[1].trim();
      body = [];
    } else body.push(line);
  }
  flush();
  return out;
}

const AGENT_DETAIL_RE =
  /<details class="agent-detail">\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;

type MdPart =
  | { kind: "md"; text: string }
  | { kind: "detail"; summary: string; body: string };

// Split a section body into Markdown spans and agent-detail blocks. Rendered via
// a dedicated component, never as raw HTML (Markdown escapes HTML) — this is the
// safe renderer for the <details class="agent-detail"> convention.
function splitAgentDetail(source: string): MdPart[] {
  const parts: MdPart[] = [];
  let last = 0;
  AGENT_DETAIL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AGENT_DETAIL_RE.exec(source))) {
    if (m.index > last) parts.push({ kind: "md", text: source.slice(last, m.index) });
    parts.push({ kind: "detail", summary: m[1].trim(), body: m[2].trim() });
    last = m.index + m[0].length;
  }
  if (last < source.length) parts.push({ kind: "md", text: source.slice(last) });
  return parts.length ? parts : [{ kind: "md", text: source }];
}

// Render a body's Markdown + agent-detail blocks. Collapsed content is clipped
// (max-h-0), never unmounted, so AnnotationLayer highlights survive and the
// container's text content is stable regardless of collapse state.
function BodyParts({ source, detailOpen }: { source: string; detailOpen: boolean }) {
  return (
    <>
      {splitAgentDetail(source).map((p, i) =>
        p.kind === "md" ? (
          <Markdown key={i} source={p.text} />
        ) : (
          <AgentDetailBlock key={i} summary={p.summary} body={p.body} forceOpen={detailOpen} />
        ),
      )}
    </>
  );
}

function AgentDetailBlock({
  summary,
  body,
  forceOpen,
}: {
  summary: string;
  body: string;
  forceOpen: boolean;
}) {
  const [open, setOpen] = useState(forceOpen);
  useEffect(() => setOpen(forceOpen), [forceOpen]);
  return (
    <div className="my-2 rounded border border-stone-200 dark:border-stone-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs font-medium text-stone-500 hover:bg-stone-50 dark:hover:bg-stone-800"
      >
        <Caret open={open} />
        {summary || "Agent detail"}
      </button>
      <div className={open ? "px-3 pb-2" : "max-h-0 overflow-hidden"} aria-hidden={!open}>
        <Markdown source={body} />
      </div>
    </div>
  );
}

function SectionBlock({
  heading,
  body,
  level,
}: {
  heading: string;
  body: string;
  level: DetailLevel;
}) {
  const isMethod = METHOD_SECTIONS.includes(heading);
  // compact shows only the contract sections' bodies; standard/full show method
  // bodies too. The heading itself always renders so the structure stays visible.
  const forceOpen = !isMethod || level !== "compact";
  const [open, setOpen] = useState(forceOpen);
  useEffect(() => setOpen(forceOpen), [forceOpen]);
  return (
    <div>
      <div data-outline-id={heading}>
        <Markdown source={`## ${heading}`} />
      </div>
      {isMethod && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mb-1 flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
        >
          <Caret open={open} />
          {open ? "hide" : "show section"}
        </button>
      )}
      <div className={open ? "" : "max-h-0 overflow-hidden"} aria-hidden={!open}>
        {heading === "Build steps" ? (
          <StepCards body={body} detailOpen={level === "full"} />
        ) : (
          <BodyParts source={body} detailOpen={level === "full"} />
        )}
      </div>
    </div>
  );
}

/**
 * Renders a plan body as one narrative, collapsing by the project's detail level:
 * `compact` clips the method sections (approach/steps/verification), `standard`
 * shows them, `full` also expands the inline agent-detail blocks. Everything
 * stays inside the caller's single AnnotationLayer, clipped never unmounted, so
 * comment anchoring is unaffected. Pre-v0.4 plans still carrying a "## Part 2 —"
 * banner fall back to the old two-half render.
 */
export default function PlanBody({
  content,
  level,
  stripMetadata,
}: {
  content: string;
  level: DetailLevel;
  stripMetadata: boolean;
}) {
  // Strip HTML comments before rendering: the execution-plan template carries a
  // guidance comment that itself contains a literal <details class="agent-detail">
  // example, which the agent-detail matcher would otherwise surface as content
  // (and Markdown escapes comments into ugly literal text). Comments are never
  // rendered content, so removing them does not perturb annotation anchoring.
  const clean = content.replace(/<!--[\s\S]*?-->/g, "");
  if (/^## Part 2\b/m.test(clean)) return <LegacyPlanBody content={clean} />;
  const sections = splitSections(clean);
  return (
    <>
      {sections.map((s, i) =>
        s.heading === null ? (
          <BodyParts
            key="preamble"
            source={stripMetadata ? stripPreambleMetadata(s.body) : s.body}
            detailOpen={level === "full"}
          />
        ) : (
          <SectionBlock key={s.heading + i} heading={s.heading} body={s.body} level={level} />
        ),
      )}
    </>
  );
}

// Pre-v0.4 plans: split on the "## Part 2 —" banner, Part 2 collapsed under a
// toggle (the original render, kept so old plans still read correctly).
function LegacyPlanBody({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const m = /^## Part 2\b[^\n]*$/m.exec(content);
  if (!m) return <Markdown source={content} />;
  const human = content.slice(0, m.index);
  const agent = content.slice(m.index + m[0].length);
  const heading = m[0].replace(/^##\s*/, "").trim();
  return (
    <>
      <Markdown source={human} />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-4 flex w-full items-center gap-2 border-t border-stone-200 dark:border-stone-800 pt-4 text-left text-lg font-bold text-stone-900 dark:text-stone-100 hover:text-stone-600"
      >
        <Caret open={open} />
        {heading}
      </button>
      <div className={open ? "mt-2" : "max-h-0 overflow-hidden"} aria-hidden={!open}>
        <Markdown source={agent} />
      </div>
    </>
  );
}
