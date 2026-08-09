import type { Reminder } from "@/types";

export function formatCurrency(amount?: number | null): string {
  if (!amount) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Renders an instant in the signed-in user's zone. `timeZone` comes from their
 * own preferences; when it is omitted Intl falls back to the browser's zone,
 * which is usually the same thing but is not guaranteed to be — so pass it.
 */
export function formatDate(value: string | Date, timeZone?: string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  // dd/mm/yyyy, zero-padded. Numeric rather than "3 Aug 2026" so every date is the
  // same width in a list and reads the way dates are written here.
  return d.toLocaleDateString("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatTime(value: string | Date, timeZone?: string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleTimeString("en-GB", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** "3 Aug 2026, 5:30 pm" — or just the date when the reminder carries no time. */
export function formatDateTime(
  value: string | Date,
  hasTime = true,
  timeZone?: string,
): string {
  const date = formatDate(value, timeZone);
  return hasTime ? `${date}, ${formatTime(value, timeZone)}` : date;
}

/** Wall-clock parts of an instant as seen in `timeZone`. */
function zonedParts(d: Date, timeZone?: string) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const out: Record<string, string> = {};
  for (const p of dtf.formatToParts(d)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return out;
}

/** yyyy-mm-ddThh:mm for <input type="datetime-local">, in the user's zone. */
export function toDateTimeInputValue(
  value?: string | Date | null,
  timeZone?: string,
): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const p = zonedParts(d, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** yyyy-mm-dd, in the user's zone — used for calendar grouping. */
export function toDateKey(
  value?: string | Date | null,
  timeZone?: string,
): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const p = zonedParts(d, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Whole minutes from now until `due` — negative once overdue. */
export function minutesUntil(due: string | Date): number {
  const d = typeof due === "string" ? new Date(due) : due;
  return Math.round((d.getTime() - Date.now()) / 60_000);
}

export interface ReminderStatus {
  label: string;
  tone: "overdue" | "today" | "soon" | "upcoming" | "done";
  className: string;
}

function coarse(mins: number): string {
  const abs = Math.abs(mins);
  if (abs < 60) return `${abs}m`;
  if (abs < 60 * 24) return `${Math.round(abs / 60)}h`;
  return `${Math.round(abs / (60 * 24))}d`;
}

export function reminderStatus(r: Reminder): ReminderStatus {
  if (r.status === "completed")
    return { label: "Completed", tone: "done", className: "text-green-500" };
  if (r.status === "archived")
    return { label: "Archived", tone: "done", className: "text-muted-foreground" };

  const mins = minutesUntil(r.dueAt);

  if (mins < 0)
    return {
      label: `Overdue ${coarse(mins)}`,
      tone: "overdue",
      className: "text-red-500",
    };
  if (mins < 60)
    return { label: `In ${mins}m`, tone: "today", className: "text-orange-500" };
  if (mins < 60 * 24)
    return {
      label: `In ${Math.round(mins / 60)}h`,
      tone: "today",
      className: "text-orange-400",
    };

  const days = Math.round(mins / (60 * 24));
  if (days <= 7)
    return { label: `In ${days}d`, tone: "soon", className: "text-yellow-500" };
  return { label: `In ${days}d`, tone: "upcoming", className: "text-blue-400" };
}
