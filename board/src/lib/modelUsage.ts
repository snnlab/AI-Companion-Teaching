// Model provenance parsing + display helpers. Every consumer runs raw artifact
// data through coerceModelUsage so a hand-edited plan/manifest/scorecard can
// never crash a surface, and the plan marker parser strips its line even when
// the JSON is invalid (an unclosed HTML comment would otherwise swallow the
// whole plan body when rendered).
import type { ModelUsage } from "./types";

function side(x: unknown): ModelUsage | null {
  if (!x || typeof x !== "object") return null;
  const s = x as Record<string, unknown>;
  if (typeof s.model !== "string" || !s.model) return null;
  return { model: s.model, effort: typeof s.effort === "string" ? s.effort : null };
}

/** Coerce untrusted JSON into a ModelUsage, or null when nothing is usable.
 * Bundles sealed before the simplification carry `{prescribed, reported}`, and
 * bundles are immutable, so that shape is read forever: prefer what actually
 * ran (reported) over what the profile asked for (prescribed). */
export function coerceModelUsage(x: unknown): ModelUsage | null {
  if (!x || typeof x !== "object") return null;
  const u = x as Record<string, unknown>;
  return side(u) ?? side(u.reported) ?? side(u.prescribed);
}

export const PLAN_MARKER_PREFIX = "<!-- aict-model";
const PLAN_MARKER_PREFIXES = ["<!-- aict-model"];

export interface ParsedPlanModel {
  modelUsage: ModelUsage | null;
  malformed: boolean; // first line claimed to be a marker but did not validate
  body: string; // always safe to render
}

/** A plan version's first line may be `<!-- aict-model {ModelUsage json} -->`.
 * Strip it before rendering (mirrors reportMarker), tolerating bad JSON. */
export function parsePlanModelMarker(content: string): ParsedPlanModel {
  const nl = content.indexOf("\n");
  const first = nl === -1 ? content : content.slice(0, nl);
  if (!PLAN_MARKER_PREFIXES.some((p) => first.trimStart().startsWith(p))) {
    return { modelUsage: null, malformed: false, body: content };
  }
  const body = nl === -1 ? "" : content.slice(nl + 1);
  const m = /^<!--\s*aict-model\s+(\{.*\})\s*-->\s*$/.exec(first.trim());
  if (!m) return { modelUsage: null, malformed: true, body };
  try {
    const usage = coerceModelUsage(JSON.parse(m[1]));
    return { modelUsage: usage, malformed: usage === null, body };
  } catch {
    return { modelUsage: null, malformed: true, body };
  }
}

export function stripPlanMarkerLine(content: string): string {
  return parsePlanModelMarker(content).body;
}

/** The text a ModelChip shows, or null when there is nothing to show.
 * `label` frames it (e.g. "captured by sonnet·low"). */
export function modelChipText(usage: ModelUsage, label?: string): string | null {
  if (!usage.model) return null;
  const core = usage.effort ? `${usage.model}·${usage.effort}` : usage.model;
  return label ? `${label} ${core}` : core;
}
