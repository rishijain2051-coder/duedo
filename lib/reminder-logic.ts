// Pure helpers shared by the reminder API routes.

import { parseDueAt, LEAD_OFFSET_VALUES } from "./time";
import { isAudience } from "./recipients";
import { PRIORITY_OPTIONS, RECURRENCE_OPTIONS, REMINDER_STATUSES } from "@/types";

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
  if (data.title !== undefined) out.title = String(data.title).trim();
  if (data.description !== undefined)
    out.description = data.description ? String(data.description) : null;
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
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d;
    case "Quarterly":
      d.setUTCMonth(d.getUTCMonth() + 3);
      return d;
    case "Half-Yearly":
      d.setUTCMonth(d.getUTCMonth() + 6);
      return d;
    case "Yearly":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      return d;
    default:
      return null;
  }
}
