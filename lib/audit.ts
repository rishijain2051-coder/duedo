import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

// Audit trail. Node-only.
//
// Deliberately best-effort: a failed audit write must never fail the action it
// was recording. Losing a log line is bad; refusing to approve someone because
// the log line failed is worse.

export type AuditAction =
  // account lifecycle
  | "user.register"
  | "user.verify.email"
  | "user.login"
  | "user.login.failed"
  | "user.approve"
  | "user.reject"
  | "user.role"
  | "user.delete"
  | "user.pin.reset"
  | "user.pin.change"
  /** The install changed hands. Rare, and the most consequential entry here. */
  | "user.root.transfer"
  /** Someone claimed a shared reminder. The one accountability act worth a trail. */
  | "reminder.acknowledge"
  /**
   * The Shortcuts token issued or withdrawn. Worth a line for the same reason a PIN
   * change is: it is the creation of a credential that can act on the account later,
   * and the only record that it exists at all is a hash nobody can read back.
   */
  | "user.api-token.create"
  | "user.api-token.revoke"
  /**
   * Paid access granted, extended or withdrawn by the owner. There is no checkout, so
   * these two lines are the payment ledger: the grant records both ends of the date it
   * moved and the note says what it was paid for. Without them a dispute six months
   * later has nothing to appeal to but somebody's WhatsApp history.
   */
  | "plan.grant"
  | "plan.revoke"
  /** The renewal warning, which doubles as its own once-a-day guard. */
  | "plan.expiring"
  // families
  | "family.create"
  | "family.rename"
  /** Ranking, streaks, nudges or the monthly mail switched on or off by the head. */
  | "family.settings"
  /**
   * The monthly summary to a head. Doubles as the once-a-month guard, the same way
   * audit.rotate does for the daily dump — see lib/family-report.ts.
   */
  | "family.report"
  | "family.code.rotate"
  | "family.join"
  | "family.member.remove"
  | "family.member.leave"
  | "family.head.transfer"
  | "family.dissolve"
  // admin reaching into another account
  | "admin.read.reminders"
  | "admin.read.family"
  // Housekeeping. Written straight after the daily dump is mailed and the surplus
  // entries trimmed, so the log carries a line saying where the older history went —
  // and doubles as the "already done today" marker.
  | "audit.rotate"
  /**
   * The same, for pg_cron's own run log. Postgres writes a row a minute there and
   * removes none, so it is mailed to the owner daily and trimmed to a day — see
   * lib/cron-log-rotate.ts. Doubles as that rotation's once-a-day marker.
   */
  | "cron.rotate";

interface RecordArgs {
  /** Null for system actions such as the dispatcher. */
  actorId: string | null;
  action: AuditAction;
  entity: "user" | "family" | "reminder" | "session" | "system" | "audit";
  entityId?: string | null;
  detail?: Prisma.InputJsonValue;
}

export async function audit({
  actorId,
  action,
  entity,
  entityId,
  detail,
}: RecordArgs): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: { actorId, action, entity, entityId: entityId ?? null, detail },
    });
  } catch (err) {
    console.error(`[audit] could not record ${action}:`, (err as Error).message);
  }
}
