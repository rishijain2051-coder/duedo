// Pure helpers shared by the reminder API routes.

import { parseDueAt, LEAD_OFFSET_VALUES } from "./time";
// isAudience straight from @/types, not via lib/recipients which merely re-exports it:
// that module imports prisma, and going through it made this whole file — including the
// recurrence arithmetic — unreachable from a client component. The offline queue needs
// computeNextDueAt to show a completed recurring reminder at its next date, and a second
// copy of that rule would be a second thing to keep in step.
import {
  isAudience,
  PRIORITY_OPTIONS,
  RECURRENCE_OPTIONS,
  REMINDER_STATUSES,
} from "@/types";

/**
 * Caps on the free-text fields.
 *
 * Nothing bounded these — `title` and `description` are unbounded Postgres text and the
 * only handling was `.trim()`. The reason it matters is not storage:
 *
 *   * a web push payload carries the title, and the service's limit is about 4 kB. Over
 *     that, every push for that reminder failed — and a failure used to count against
 *     the *device*, so five nags about one long-titled reminder retired the subscription
 *     and silenced every other reminder too (see lib/push.ts);
 *   * the title is also the email subject line, and the notification feed's title.
 *
 * Truncated rather than refused, deliberately. These are generous enough that no real
 * reminder reaches them, so a 400 here would only ever be a wall someone hit by pasting,
 * losing the whole save over a field the app could simply have shortened.
 */
export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 2000;
export const MAX_REMARKS = 500;

/** Trims, then caps. Used for every free-text field a client can write. */
export function capText(value: unknown, max: number): string {
  return String(value).trim().slice(0, max);
}

/**
 * Keeps a value only if it is one of the ones the app knows about.
 *
 * Unrecognised values are dropped rather than rejected, matching how `audience`
 * is handled: on create the field falls back to its default, and on update it is
 * left as it was. An old client sending a value that has since been renamed
 * therefore loses that one field instead of the whole save.
 */
function oneOf(value: unknown, allowed: readonly string[]): string | undefined {
  const s = String(value);
  return allowed.includes(s) ? s : undefined;
}

/** Keeps only offsets the UI actually offers, de-duplicated, longest lead first. */
export function sanitizeLeadOffsets(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const valid = input
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && LEAD_OFFSET_VALUES.includes(n));
  return [...new Set(valid)].sort((a, b) => b - a);
}

/**
 * Whitelists and normalises what the client sent.
 *
 * Note what is *absent*: `userId`. Ownership is never taken from the request
 * body — the route sets it from the session — so there is no way to create a
 * reminder in, or move one into, somebody else's account.
 */
export function sanitizeReminderInput(
  data: Record<string, unknown>,
  isCreate: boolean,
  timeZone: string,
  defaultTime: string,
) {
  const out: Record<string, unknown> = {};
  if (data.title !== undefined) out.title = capText(data.title, MAX_TITLE);
  if (data.description !== undefined)
    out.description = data.description
      ? capText(data.description, MAX_DESCRIPTION)
      : null;
  // Forced to a string so a number or an object in the body can't reach a Prisma
  // `where` clause, which would throw a validation error and surface as a 500.
  if (data.categoryId !== undefined)
    out.categoryId = data.categoryId ? String(data.categoryId) : null;

  // Which list the reminder lives on. Whitelisted here but *verified* in the
  // route — membership can't be checked without the database, and this file
  // stays pure so it can be reasoned about on its own.
  if (data.familyId !== undefined)
    out.familyId = data.familyId ? String(data.familyId) : null;
  if (data.assignedToId !== undefined)
    out.assignedToId = data.assignedToId ? String(data.assignedToId) : null;
  if (data.audience !== undefined && isAudience(data.audience))
    out.audience = data.audience;
  if (data.priority !== undefined) out.priority = oneOf(data.priority, PRIORITY_OPTIONS);
  if (data.status !== undefined) out.status = oneOf(data.status, REMINDER_STATUSES);
  if (data.recurrenceRule !== undefined)
    out.recurrenceRule = oneOf(data.recurrenceRule, RECURRENCE_OPTIONS);
  if (data.leadOffsets !== undefined)
    out.leadOffsets = sanitizeLeadOffsets(data.leadOffsets);
  if (data.amount !== undefined) {
    const n = data.amount === "" || data.amount == null ? 0 : Number(data.amount);
    // NaN would reach the database as a Float and fail there instead of here.
    out.amount = Number.isFinite(n) ? n : 0;
  }

  // Escalation is validated in the route rather than here: parseEscalation throws
  // HttpError, and assertContactsOwned needs the database — neither belongs in this file,
  // which stays pure. Passed straight through so the route can validate and overwrite it.
  if (data.escalation !== undefined) out.escalation = data.escalation;

  // The client sends wall-clock text ("2026-08-03T17:30" or "2026-08-03"); the
  // absolute instant is resolved here so the user's own zone is the only source
  // of truth.
  if (data.dueAt !== undefined && data.dueAt !== null && data.dueAt !== "") {
    try {
      const { dueAt, hasTime } = parseDueAt(String(data.dueAt), timeZone, defaultTime);
      out.dueAt = dueAt;
      out.hasTime = hasTime;
    } catch {
      // parseDueAt throws on text it can't read. Recording an Invalid Date rather
      // than rethrowing keeps this file free of HTTP concerns; the check in
      // lib/reminder-scope turns it into a 400 with a message, and does so on
      // updates as well as creates — dropping the field silently would let a
      // mangled date leave the old one in place and look like a save that worked.
      out.dueAt = new Date(NaN);
    }
  }

  if (isCreate) {
    if (out.priority === undefined) out.priority = "normal";
    if (out.status === undefined) out.status = "active";
    if (out.recurrenceRule === undefined) out.recurrenceRule = "One Time";
    if (out.amount === undefined) out.amount = 0;
    if (out.leadOffsets === undefined) out.leadOffsets = [];
    if (out.familyId === undefined) out.familyId = null;
    if (out.audience === undefined) out.audience = "owner";
  }

  // A personal reminder has nobody to assign to and no audience beyond its owner,
  // so the rest of the app never has to consider "personal, but addressed to a
  // family". Only *absent* fields are filled in here: a body that actually asked
  // for an assignee or a wider audience is left alone so lib/reminder-scope can
  // refuse it and say why. Overwriting it instead would hand back a reminder that
  // quietly wasn't what the caller filled in.
  if (out.familyId === null) {
    if (out.assignedToId === undefined) out.assignedToId = null;
    if (out.audience === undefined) out.audience = "owner";
  }

  return out;
}

/**
 * Adds whole months, clamping to the end of the target month.
 *
 * `setUTCMonth` alone overflows, and the overflow is not a rounding detail — it skips a
 * month. 31 January plus one month is 31 February, which JavaScript normalises to 3
 * March: February never gets a reminder at all, and every roll after that sits on the
 * 3rd, so a rent reminder dated the 31st quietly moves to the 3rd for good. Quarterly
 * was worse (31 August → 1 December) and Yearly broke on leap days (29 February 2024 →
 * 1 March 2025).
 *
 * Clamping to the last day of the target month keeps the reminder in the month it
 * belongs to. It does not restore the original day afterwards — 31 January becomes 28
 * February and then 28 March — because the only anchor available here is the previous
 * due date. Holding the intended day-of-month would mean storing it on the reminder;
 * that is a schema change, and skipping a month was the actual defect.
 */
function addMonths(from: Date, months: number): Date {
  const day = from.getUTCDate();
  const d = new Date(from);
  // To the 1st first, so the month arithmetic itself can never overflow.
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDayOfMonth = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDayOfMonth));
  return d;
}

/**
 * Rolls a due instant forward by one recurrence step, preserving the time of day.
 * Returns null for one-off reminders.
 */
export function computeNextDueAt(from: Date, rule: string | null): Date | null {
  if (!rule || rule === "One Time") return null;
  const d = new Date(from);
  switch (rule) {
    case "Daily":
      d.setUTCDate(d.getUTCDate() + 1);
      return d;
    case "Weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      return d;
    case "Monthly":
      return addMonths(from, 1);
    case "Quarterly":
      return addMonths(from, 3);
    case "Half-Yearly":
      return addMonths(from, 6);
    case "Yearly":
      // Twelve months rather than +1 year, so 29 February lands on the 28th instead
      // of stepping into March.
      return addMonths(from, 12);
    default:
      return null;
  }
}
