// The generated report's first line is a machine-readable identity marker:
// <!-- aict-report {"schemaVersion": 2, "component": "<NN-slug>", "bundle": N,
//      "plan": N|null, "validation": "<manifest validation status or none>",
//      "generated": "<ISO>"} -->
// The board ALWAYS strips the first line before rendering when it starts with
// the prefix — Marked treats an unclosed comment as swallowing the whole
// document, so rendering must never see a malformed marker.
import { coerceModelUsage } from "./modelUsage";
import type { ModelUsage } from "./types";

export interface ReportMarker {
  schemaVersion: 1 | 2;
  component: string;
  bundle: number;
  plan: number | null;
  verdict?: "accepted" | "changes-requested" | "pending";
  validation?: string;
  generated: string;
  modelUsage?: ModelUsage; // which model generated the report (reported only)
}

export interface ParsedReport {
  marker: ReportMarker | null;
  malformed: boolean; // first line claimed to be a marker but did not validate
  body: string; // always safe to render
}

export const MARKER_PREFIX = "<!-- aict-report";
const MARKER_PREFIXES = ["<!-- aict-report"];
export const REPORT_DOCKEY_RE = /^plans\/reports\/(.+)-r(\d+)-report\.md$/;

const VERDICTS = new Set(["accepted", "changes-requested", "pending"]);
const VALIDATIONS = new Set([
  "conforms",
  "conforms-with-amendments",
  "deviations-found",
  "unverifiable",
  "skipped",
  "not-applicable",
  "none",
]);

export function parseReport(content: string): ParsedReport {
  const nl = content.indexOf("\n");
  const first = nl === -1 ? content : content.slice(0, nl);
  if (!MARKER_PREFIXES.some((p) => first.trimStart().startsWith(p))) {
    return { marker: null, malformed: false, body: content };
  }
  const body = nl === -1 ? "" : content.slice(nl + 1);
  const m = /^<!--\s*aict-report\s+(\{.*\})\s*-->\s*$/.exec(first.trim());
  if (!m) return { marker: null, malformed: true, body };
  try {
    const j = JSON.parse(m[1]) as Record<string, unknown>;
    const commonFieldsValid =
      typeof j.component === "string" &&
      typeof j.bundle === "number" &&
      (typeof j.plan === "number" || j.plan === null) &&
      typeof j.generated === "string";
    const v1Valid =
      j.schemaVersion === 1 &&
      typeof j.verdict === "string" &&
      VERDICTS.has(j.verdict);
    const v2Valid =
      j.schemaVersion === 2 &&
      typeof j.validation === "string" &&
      VALIDATIONS.has(j.validation);
    if (commonFieldsValid && (v1Valid || v2Valid)) {
      return {
        marker: {
          schemaVersion: j.schemaVersion as 1 | 2, component: j.component as string,
          bundle: j.bundle as number, plan: j.plan as number | null,
          verdict: v1Valid ? j.verdict as ReportMarker["verdict"] : undefined,
          validation: v2Valid ? j.validation as string : undefined,
          generated: j.generated as string,
          modelUsage: coerceModelUsage(j.modelUsage) ?? undefined,
        },
        malformed: false, body,
      };
    }
  } catch { /* fall through to malformed */ }
  return { marker: null, malformed: true, body };
}

export function stripMarkerLine(content: string): string {
  return parseReport(content).body;
}
