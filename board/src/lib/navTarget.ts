// Click-sync navigation targets (control surface, spec §2): a feedback card
// maps to the tab + view selection that shows its highlight. Pure; App applies
// targets via each view's navRequest prop.
import type { Annotation, BoardData } from "./types";
import { REPORT_DOCKEY_RE } from "./reportMarker";

export interface NavTarget {
  tab: "tracker" | "plans" | "results" | "timeline" | "archive" | "reports" | "manuscript";
  component?: string;
  planPath?: string; // -> PlanReader resolves to its doc index
  resultsVersion?: number; // -> Results resolves to its bundle index
  scriptPath?: string; // -> Results opens this script viewer
  archivePath?: string; // -> Archive resolves to its version index
  clearTimelineFilter?: boolean;
  annotationId: string;
  anchored: boolean;
}

export function navTargetFor(a: Annotation, _data: BoardData): NavTarget {
  switch (a.type) {
    case "plan-comment":
      return {
        tab: "plans",
        component: a.component,
        planPath: a.planPath,
        annotationId: a.id,
        anchored: a.anchored,
      };
    case "result-comment": {
      const surface = a.target.surfaceScope ?? "";
      return {
        tab: "results",
        component: a.component,
        resultsVersion: a.resultsVersion,
        // provenance-script:<label> selections live inside the script viewer
        scriptPath: surface.startsWith("provenance-script:")
          ? surface.slice("provenance-script:".length)
          : undefined,
        annotationId: a.id,
        anchored: a.anchored !== false,
      };
    }
    case "script-comment":
      return {
        tab: "results",
        component: a.component,
        resultsVersion: a.resultsVersion,
        scriptPath: a.script,
        annotationId: a.id,
        anchored: true, // line-anchored; the viewer renders saved ranges
      };
    case "doc-comment": {
      switch (a.view) {
        case "tracker":
          return { tab: "tracker", annotationId: a.id, anchored: a.anchored };
        case "manuscript":
          return { tab: "manuscript", annotationId: a.id, anchored: a.anchored };
        case "timeline":
          return {
            tab: "timeline",
            clearTimelineFilter: true,
            annotationId: a.id,
            anchored: a.anchored,
          };
        case "archive":
          return {
            tab: "archive",
            archivePath: a.docKey.startsWith("archive:")
              ? a.docKey.slice("archive:".length)
              : a.docKey,
            annotationId: a.id,
            anchored: a.anchored,
          };
        case "reports": {
          const m = REPORT_DOCKEY_RE.exec(a.docKey);
          return {
            tab: "reports",
            component: m?.[1],
            resultsVersion: m ? Number(m[2]) : undefined,
            annotationId: a.id,
            anchored: a.anchored,
          };
        }
      }
      break;
    }
    case "general": {
      const tab = a.view as NavTarget["tab"];
      return {
        tab,
        clearTimelineFilter: tab === "timeline" ? true : undefined,
        annotationId: a.id,
        anchored: false, // general comments have no highlight
      };
    }
  }
  // Unreachable for the current union; safe fallback if a view widens.
  return {
    tab: "tracker",
    annotationId: (a as Annotation).id,
    anchored: false,
  };
}
