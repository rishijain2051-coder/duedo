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
  // families
  | "family.create"
  | "family.rename"
  | "family.code.rotate"
  | "family.join"
  | "family.member.remove"
  | "family.member.leave"
  | "family.head.transfer"
  | "family.dissolve"
  // admin reaching into another account
  | "admin.read.reminders"
  | "admin.read.family"
  // Housekeeping. Written straight after the daily dump is mailed and the old
  // entries deleted, so an emptied log still opens with a line saying where the
  // previous day's history went — and doubles as the "already done today" marker.
  | "audit.rotate";

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
