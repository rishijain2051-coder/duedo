import { prisma } from "./db";
import { HttpError } from "./http";

// Escalation chains: who to tell when the person responsible hasn't dealt with it.
//
// Borrowed wholesale from incident management, where the idea is that an unacknowledged
// alert should climb until somebody owns it. Household paperwork has the same shape and
// none of the tooling — an insurance renewal that lapses because one person was away is
// the same failure as an unattended page.
//
// Stored as Json on the reminder rather than a table: per-reminder, never queried by
// content, and a policy table would only earn its place if policies were shared.

/** The most steps one reminder may have. Beyond this it isn't a chain, it's a mailing list. */
const MAX_STEPS = 4;

/** Anything sooner than this is the overdue nag with extra recipients, not an escalation. */
const MIN_AFTER_MINS = 15;

/** A fortnight, matching OVERDUE_NAG_LIMIT_DAYS in lib/dispatch.ts. */
const MAX_AFTER_MINS = 14 * 24 * 60;

export const ESCALATION_TARGETS = ["assignee", "head", "admins", "external"] as const;
export type EscalationTarget = (typeof ESCALATION_TARGETS)[number];

export interface EscalationStep {
  /** Minutes after the due instant at which this step fires. */
  afterMins: number;
  notify: EscalationTarget;
  /** Required for `external`; an ExternalContact belonging to the reminder's creator. */
  contactId?: string;
}

/**
 * Validates a chain from a request body, or throws.
 *
 * Steps come back sorted and de-duplicated by `afterMins`, because the dedupe key the
 * dispatcher uses is `(…, kind, offsetMin)` — two steps at the same minute would collide
 * on it and the second would silently never fire. Sorting here means the stored shape and
 * the fired order always agree.
 */
export function parseEscalation(raw: unknown): EscalationStep[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) throw new HttpError(400, "Escalation must be a list of steps.");
  if (raw.length === 0) return null;
  if (raw.length > MAX_STEPS) {
    throw new HttpError(400, `At most ${MAX_STEPS} escalation steps.`);
  }

  const steps: EscalationStep[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      throw new HttpError(400, "Each escalation step must be an object.");
    }
    const e = entry as Record<string, unknown>;
    const afterMins = Number(e.afterMins);
    if (!Number.isFinite(afterMins) || afterMins < MIN_AFTER_MINS || afterMins > MAX_AFTER_MINS) {
      throw new HttpError(
        400,
        `Each step must fire between ${MIN_AFTER_MINS} minutes and 14 days after the due time.`,
      );
    }
    const notify = String(e.notify) as EscalationTarget;
    if (!ESCALATION_TARGETS.includes(notify)) {
      throw new HttpError(400, "Escalate to the assignee, the head, admins or an external contact.");
    }
    if (notify === "external" && typeof e.contactId !== "string") {
      throw new HttpError(400, "Pick a contact for the external step.");
    }
    steps.push({
      afterMins: Math.round(afterMins),
      notify,
      ...(notify === "external" ? { contactId: String(e.contactId) } : {}),
    });
  }

  const byMinute = new Map<number, EscalationStep>();
  for (const s of steps) byMinute.set(s.afterMins, s);
  return [...byMinute.values()].sort((a, b) => a.afterMins - b.afterMins);
}

/** Reads a stored chain back, tolerating anything unexpected by ignoring it. */
export function readEscalation(raw: unknown): EscalationStep[] {
  if (!Array.isArray(raw)) return [];
  const out: EscalationStep[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const afterMins = Number(e.afterMins);
    const notify = String(e.notify) as EscalationTarget;
    if (!Number.isFinite(afterMins)) continue;
    if (!ESCALATION_TARGETS.includes(notify)) continue;
    out.push({
      afterMins,
      notify,
      ...(typeof e.contactId === "string" ? { contactId: e.contactId } : {}),
    });
  }
  return out.sort((a, b) => a.afterMins - b.afterMins);
}

/**
 * Confirms every external contact a chain names actually belongs to the caller.
 *
 * Without this, a contact id from anywhere would do — and a reminder could be pointed at
 * an address the creator has no relationship with, which is the whole thing the
 * confirmation flow exists to prevent.
 */
export async function assertContactsOwned(
  steps: EscalationStep[],
  userId: string,
): Promise<void> {
  const ids = steps.map((s) => s.contactId).filter((v): v is string => Boolean(v));
  if (ids.length === 0) return;
  const owned = await prisma.externalContact.count({
    where: { id: { in: [...new Set(ids)] }, ownerId: userId },
  });
  if (owned !== new Set(ids).size) {
    throw new HttpError(400, "One of those contacts isn't yours.");
  }
}
