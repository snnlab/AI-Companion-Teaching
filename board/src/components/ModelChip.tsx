import { modelChipText } from "../lib/modelUsage";
import type { ModelUsage } from "../lib/types";

// A small provenance pill: which model a plan / result / report / review used,
// as that session reported it. Renders nothing when there is no usable
// provenance (old artifacts).
export default function ModelChip({
  usage,
  label,
  className = "",
}: {
  usage: ModelUsage | null | undefined;
  label?: string;
  className?: string;
}) {
  if (!usage) return null;
  const text = modelChipText(usage, label);
  if (!text) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/50 px-2 py-0.5 text-[10px] font-medium text-stone-600 dark:text-stone-400 ${className}`}
      title="Model provenance — self-attested by the session that did the work, not verified runtime truth."
    >
      <span className="font-mono">{text}</span>
    </span>
  );
}
