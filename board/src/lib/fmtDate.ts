// Shown in the VIEWER's local time. Timestamps arrive with mixed offsets —
// submittedAt carries the student's own offset (+09:00), releasedAt is the
// server's UTC 'Z' — so slicing the raw string showed them on two clocks.
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.length >= 16 ? iso.slice(0, 16).replace("T", " ") : iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
