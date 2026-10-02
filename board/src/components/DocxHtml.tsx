import { memo, useMemo } from "react";
import { sanitizeDocxHtml } from "../lib/docxHtml";

// A Word manuscript converted to HTML by board.py, rebuilt from an allowlist
// before it touches the DOM (see lib/docxHtml.ts). Memoized for the same
// reason as Markdown: a re-render must not tear out the comment <mark>s
// AnnotationLayer painted into this DOM.
function DocxHtml({ html, assets }: { html: string; assets?: Record<string, string> }) {
  const safe = useMemo(() => sanitizeDocxHtml(html, assets ?? {}), [html, assets]);
  return <div className="prose-md docx" dangerouslySetInnerHTML={{ __html: safe }} />;
}

export default memo(DocxHtml);
