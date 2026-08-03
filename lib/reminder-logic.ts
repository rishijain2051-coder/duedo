// Pure helpers shared by the reminder API routes.

import { parseDueAt, LEAD_OFFSET_VALUES } from "./time";

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
  if (data.title !== undefined) out.title = String(data.title);
  if (data.description !== undefined)
    out.description = data.description ? String(data.description) : null;
  if (data.categoryId !== undefined) out.categoryId = data.categoryId;
  if (data.priority !== undefined) out.priority = data.priority;
  if (data.status !== undefined) out.status = data.status;
  if (data.recurrenceRule !== undefined) out.recurrenceRule = data.recurrenceRule;
  if (data.leadOffsets !== undefined)
    out.leadOffsets = sanitizeLeadOffsets(data.leadOffsets);
  if (data.amount !== undefined)
    out.amount = data.amount === "" || data.amount == null ? 0 : Number(data.amount);

  // The client sends wall-clock text ("2026-08-03T17:30" or "2026-08-03"); the
  // absolute instant is resolved here so the user's own zone is the only source
  // of truth.
  if (data.dueAt !== undefined && data.dueAt !== null && data.dueAt !== "") {
    const { dueAt, hasTime } = parseDueAt(String(data.dueAt), timeZone, defaultTime);
    out.dueAt = dueAt;
    out.hasTime = hasTime;
  }

  if (isCreate) {
    if (out.priority === undefined) out.priority = "normal";
    if (out.status === undefined) out.status = "active";
    if (out.recurrenceRule === undefined) out.recurrenceRule = "One Time";
    if (out.amount === undefined) out.amount = 0;
    if (out.leadOffsets === undefined) out.leadOffsets = [];
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
