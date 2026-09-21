// Model provenance parsing + display helpers. Every consumer runs raw artifact
// data through coerceModelUsage so a hand-edited plan/manifest/scorecard can
// never crash a surface, and the plan marker parser strips its line even when
// the JSON is invalid (an unclosed HTML comment would otherwise swallow the
// whole plan body when rendered).
import type { ModelSide, ModelUsage } from "./types";

const ALIASES = ["opus", "sonnet", "haiku", "fable"];

function isSide(x: unknown): x is ModelSide {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return typeof s.model === "string" && (typeof s.effort === "string" || s.effort === null);
}

/** Coerce untrusted JSON into a ModelUsage, or null when nothing is usable. */
export function coerceModelUsage(x: unknown): ModelUsage | null {
  if (!x || typeof x !== "object") return null;
  const u = x as Record<string, unknown>;
  const prescribed = isSide(u.prescribed) ? (u.prescribed as ModelSide) : null;
  const reported = isSide(u.reported) ? (u.reported as ModelSide) : null;
  if (!prescribed && !reported) return null;
  return { prescribed, reported };
}

/** Alias/full-id aware model equality. `opus` matches `claude-opus-4-8`;
 * `inherit` means "no concrete prescription" and never matches a real model. */
export function modelsEquivalent(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x === y) return true;
  if (x === "inherit" || y === "inherit") return false;
  for (const alias of ALIASES) {
    if ((x === alias && y.includes(alias)) || (y === alias && x.includes(alias))) return true;
  }
  return false;
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

function formatSide(s: ModelSide): string {
  return s.effort ? `${s.model}·${s.effort}` : s.model;
}

/** The text a ModelChip shows for a usage, or null when there is nothing to
 * show. `reportedLabel` frames the reported side (e.g. "captured by"). */
export function modelChipText(
  usage: ModelUsage,
  reportedLabel = "reported",
): { main: string; sub: string } | null {
  const { prescribed: p, reported: r } = usage;
  if (p) {
    const main = formatSide(p);
    const sub = r && !modelsEquivalent(p.model, r.model) ? `${reportedLabel} ${r.model}` : "";
    return { main, sub };
  }
  if (r) return { main: `${reportedLabel} ${formatSide(r)}`, sub: "" };
  return null;
}
