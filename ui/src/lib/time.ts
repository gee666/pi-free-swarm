const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;

const clock = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Epoch ms as "10:24 AM" today, "Yesterday", "Mon" within the week, "Apr 12" otherwise. */
export function formatTimestamp(epochMs: number, now: Date = new Date()): string {
  const date = new Date(epochMs);
  // Rounding absorbs the one-hour skew of days that cross a DST change.
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) return clock.format(date);
  if (days === 1) return "Yesterday";
  if (days < WEEK_DAYS) return weekday.format(date);
  return monthDay.format(date);
}
