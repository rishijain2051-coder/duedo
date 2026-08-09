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
 * How far ahead a reminder lands when no time was given.
 *
 * It used to take the account's `defaultTime`, which was 05:30. Saying "remind me to
 * close the door" at half past three in the afternoon therefore booked it for half past
 * five the next morning — long after the door mattered, and with nothing on screen to
 * suggest that had happened. A time nobody chose has to be a time that is soon, because
 * "no time" said out loud means "shortly", never "at my usual hour".
 *
 * Ten minutes rather than one: enough to still be useful if you are mid-sentence when
 * it saves, short enough that "close the door" is not stale.
 */
export const UNTIMED_LEAD_MINUTES = 10;

const two = (n: number) => String(n).padStart(2, "0");
const dateKey = (w: Wall) => `${w.year}-${two(w.month)}-${two(w.day)}`;

/**
 * Accepts what the reminder form and the dictation parser send, and returns the
 * absolute instant.
 *
 * `value` is either "YYYY-MM-DDTHH:mm" or a bare "YYYY-MM-DD". Without a time, the
 * reminder is placed UNTIMED_LEAD_MINUTES from now on the clock in `timeZone`.
 *
 * When the date given is today and adding those minutes crosses midnight, the date
 * moves with it — otherwise "close the door" at 23:55 would be booked for five past
 * midnight *this morning*, which is in the past and would fire immediately.
 *
 * A date further out keeps its own day and takes only the clock time. There is nothing
 * better to use: no time was chosen, so any hour is invented, and the hour it was
 * written at is at least one the person was awake for.
 *
 * `hasTime` comes back true either way. It exists to hide a placeholder hour from the
 * list, and there is no longer a placeholder to hide: ten minutes from now is a real
 * moment, and hiding it would leave "close the door" showing a bare date while it
 * quietly fired that afternoon. Rows written before this keep whatever they stored.
 */
export function parseDueAt(
  value: string,
  timeZone: string,
  now: Date = new Date(),
): { dueAt: Date; hasTime: boolean } {
  const trimmed = value.trim();
  const [datePart, timePart] = trimmed.split("T");
  const hasTime = Boolean(timePart && /^\d{2}:\d{2}/.test(timePart));

  if (hasTime) {
    return {
      dueAt: parseLocalDateTime(datePart, timePart.slice(0, 5), timeZone),
      hasTime: true,
    };
  }

  const soon = wallClock(new Date(now.getTime() + UNTIMED_LEAD_MINUTES * 60_000), timeZone);
  const askedForToday = datePart === dateKey(wallClock(now, timeZone));
  const day = askedForToday ? dateKey(soon) : datePart;
  return {
    dueAt: parseLocalDateTime(day, `${two(soon.hour)}:${two(soon.minute)}`, timeZone),
    hasTime: true,
  };
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

/**
 * The start of the month `delta` months from the one `instant` falls in.
 *
 * `delta` of -1 is last month, 1 is next. Month arithmetic is done on the 1-based
 * calendar month and normalised through Date.UTC, so December + 1 rolls the year without
 * special-casing — and the result is re-resolved through zonedToUtc, so a month boundary
 * that crosses a DST change still lands on local midnight.
 */
export function zonedMonthStartOffset(
  instant: Date,
  timeZone: string,
  delta: number,
): Date {
  const w = wallClock(instant, timeZone);
  const shifted = new Date(Date.UTC(w.year, w.month - 1 + delta, 1));
  return zonedToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    1,
    0,
    0,
    timeZone,
  );
}

/**
 * The UTC instants bounding the ISO week (Monday–Sunday) that `instant` falls in.
 *
 * Monday, because that is what a week means to the people using this — a streak that
 * resets on Sunday morning is a streak that resets mid-weekend.
 */
export function zonedWeekBounds(
  instant: Date,
  timeZone: string,
): { start: Date; end: Date } {
  const { start: dayStart } = zonedDayBounds(instant, timeZone);
  // getUTCDay on the local-midnight instant is not reliable across zones, so ask Intl.
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
    instant,
  );
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const back = Math.max(0, order.indexOf(weekday));
  const w = wallClock(dayStart, timeZone);
  const start = zonedToUtc(w.year, w.month, w.day - back, 0, 0, timeZone);
  const next = zonedToUtc(w.year, w.month, w.day - back + 7, 0, 0, timeZone);
  return { start, end: new Date(next.getTime() - 1) };
}

export function formatInZone(
  instant: Date,
  timeZone: string,
  withTime = true,
): string {
  // dd/mm/yyyy, matching formatDate in lib/format.ts — the same reminder must not read
  // one way in the app and another way in the email about it.
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
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
