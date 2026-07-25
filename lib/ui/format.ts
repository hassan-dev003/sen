/**
 * Render-boundary formatting for dates. Money formatting lives in lib/money;
 * this is the equivalent single place for turning a stored `YYYY-MM-DD` booking
 * date into something a human reads. A booking date is a date, not an instant
 * (AGENTS.md — no time zone), so these never construct a `Date` and never shift
 * across a zone boundary.
 */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function parts(iso: string): { y: string; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new RangeError(`Not an ISO date: ${JSON.stringify(iso)}`);
  return { y: m[1]!, m: Number(m[2]), d: Number(m[3]) };
}

/** `2026-07-23` → `23 Jul`. */
export function formatDayMonth(iso: string): string {
  const { m, d } = parts(iso);
  return `${d} ${MONTHS[m - 1]}`;
}

/** `2026-07-23` → `23 Jul 2026`. */
export function formatFullDate(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Today as `YYYY-MM-DD` in the given time zone (default the owner's, Asia/Kuala_Lumpur). */
export function todayIso(timeZone = "Asia/Kuala_Lumpur"): string {
  // en-CA yields ISO `YYYY-MM-DD`; formatting in a fixed zone avoids the UTC
  // rollover bug where "today" flips a day early or late near midnight.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}
