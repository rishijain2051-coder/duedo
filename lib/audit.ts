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
  | "family.join.request"
  | "family.join.approve"
  | "family.join.reject"
  | "family.member.remove"
  | "family.member.leave"
  | "family.head.transfer"
  | "family.dissolve"
  // admin reaching into another account
  | "admin.read.reminders"
  | "admin.read.family";

interface RecordArgs {
  /** Null for system actions such as the dispatcher. */
  actorId: string | null;
  action: AuditAction;
  entity: "user" | "family" | "reminder" | "session" | "system";
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
