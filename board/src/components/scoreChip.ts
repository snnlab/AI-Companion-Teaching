// 0..3 colour ramp for ScorePanel (plan scorecards).
// A 0 reads as a hard gap and gets the alarm colour;
// null (underivable channel) is muted, not alarming.
export function chipClass(score: number | null): string {
  if (score === null)
    return "border-stone-300 bg-stone-50 text-stone-400 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-500";
  if (score <= 0)
    return "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300";
  if (score === 1)
    return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300";
  if (score === 2)
    return "border-lime-300 bg-lime-50 text-lime-800 dark:border-lime-800 dark:bg-lime-950 dark:text-lime-300";
  return "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300";
}
