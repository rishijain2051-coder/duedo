// Timezone helpers.
//
// Every instant is stored in UTC and rendered in the owning user's zone
// (User.timezone, default Asia/Kolkata). India has no DST, but this is written
// against Intl rather than a fixed +05:30 offset so any zone works — which
// matters here, because each user picks their own.

const WANTED = ["year", "month", "day", "hour", "minute", "second"] as const;

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock reading `timeZone` shows for a given UTC instant. */
function wallClock(instant: Date, timeZone: string): Wall {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23", // not hour12:false — that yields "24" for midnight in some ICU builds
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out = {} as Record<string, number>;
  for (const part of dtf.formatToParts(instant)) {
    if ((WANTED as readonly string[]).includes(part.type)) {
      out[part.type] = Number(part.value);
    }
  }
  return out as unknown as Wall;
}

/** Milliseconds to add to a UTC instant to get `timeZone`'s wall clock. */
function offsetMs(instant: Date, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  return (
    Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) -
    instant.getTime()
  );
}

/**
 * Turn a wall-clock reading in `timeZone` into the absolute UTC instant.
 * The offset is resolved twice: the first pass can land on the wrong side of a
 * DST boundary, and re-resolving from that result corrects it.
 */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let off = offsetMs(new Date(guess), timeZone);
  off = offsetMs(new Date(guess - off), timeZone);
  return new Date(guess - off);
}

/** "2026-08-03" + "17:30" interpreted in `timeZone` -> UTC instant. */
export function parseLocalDateTime(
  date: string,
  time: string,
  timeZone: string,
): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  if ([y, mo, d, h, mi].some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid local date/time: "${date}" "${time}"`);
  }
  return zonedToUtc(y, mo, d, h, mi, timeZone);
}

/**
 * Accepts what the reminder form sends and returns the absolute instant.
 * `value` is either "YYYY-MM-DDTHH:mm" (datetime-local) or a bare "YYYY-MM-DD",
 * in which case `fallbackTime` ("HH:mm") is applied — that's how a reminder with
 * no explicit time ends up at the user's default time.
 */
export function parseDueAt(
  value: string,
  timeZone: string,
  fallbackTime: string,
): { dueAt: Date; hasTime: boolean } {
  const trimmed = value.trim();
  const [datePart, timePart] = trimmed.split("T");
  const hasTime = Boolean(timePart && /^\d{2}:\d{2}/.test(timePart));
  const time = hasTime ? timePart.slice(0, 5) : fallbackTime;
  return { dueAt: parseLocalDateTime(datePart, time, timeZone), hasTime };
}

/**
 * The UTC instants bounding the calendar day that `instant` falls on in
 * `timeZone`. Used so "due today" means today where the user is, not in UTC.
 */
export function zonedDayBounds(
  instant: Date,
  timeZone: string,
): { start: Date; end: Date } {
  const w = wallClock(instant, timeZone);
  const start = zonedToUtc(w.year, w.month, w.day, 0, 0, timeZone);
  // Date.UTC normalises a day past the end of the month, so no special-casing.
  const nextDay = zonedToUtc(w.year, w.month, w.day + 1, 0, 0, timeZone);
  return { start, end: new Date(nextDay.getTime() - 1) };
}

/** The UTC instant at which the current month began in `timeZone`. */
export function zonedMonthStart(instant: Date, timeZone: string): Date {
  const w = wallClock(instant, timeZone);
  return zonedToUtc(w.year, w.month, 1, 0, 0, timeZone);
}

export function formatInZone(
  instant: Date,
  timeZone: string,
  withTime = true,
): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit", hour12: true } : {}),
  }).format(instant);
}

export function formatTimeInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}

/** "2 days", "3 hours", "15 minutes" — coarse, for notification copy. */
export function humanizeMinutes(total: number): string {
  const mins = Math.max(0, Math.round(total));
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  if (mins < 60 * 24) {
    const h = Math.round(mins / 60);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round(mins / (60 * 24));
  if (d < 7) return `${d} day${d === 1 ? "" : "s"}`;
  const w = Math.round(d / 7);
  return `${w} week${w === 1 ? "" : "s"}`;
}

/** The lead offsets the UI offers, in minutes before the due instant. */
export const LEAD_OFFSET_OPTIONS = [
  { minutes: 10080, label: "1 week before" },
  { minutes: 1440, label: "1 day before" },
  { minutes: 240, label: "4 hours before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 30, label: "30 min before" },
  { minutes: 10, label: "10 min before" },
] as const;

export const LEAD_OFFSET_VALUES: readonly number[] = LEAD_OFFSET_OPTIONS.map(
  (o) => o.minutes,
);
