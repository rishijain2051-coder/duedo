import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, jsonAdmin, readJson } from "@/lib/http";
import { hashPin, isValidPin, PIN_LENGTH } from "@/lib/pin";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  accountType: true,
  approvedAt: true,
  createdAt: true,
} as const;

/**
 * ADMIN ONLY — approve, reject, or change the role of another account.
 *
 * An admin may never act on their own row here. That single rule is what keeps
 * the install from being stranded: since the acting admin is by definition an
 * active admin and can't demote, reject or delete themselves, there is always at
 * least one active admin left afterwards. No "is this the last admin?" counting
 * required.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return jsonAdmin(async (admin) => {
    const { id } = await ctx.params;
    if (id === admin.id) {
      throw new HttpError(
        400,
        "You can't change your own account here — use Settings for your profile.",
      );
    }

    const target = await prisma.user.findUnique({ where: { id }, select: SELECT });
    if (!target) throw new HttpError(404, "Account not found");

    const body = await readJson(req);
    const data: Record<string, unknown> = {};

    if (body.status !== undefined) {
      const status = String(body.status);
      if (!["active", "pending", "rejected"].includes(status)) {
        throw new HttpError(400, "Status must be active, pending or rejected.");
      }
      data.status = status;
      // Stamped on the first approval and left alone afterwards, so it records
      // when access was granted rather than when it was last touched.
      if (status === "active" && !target.approvedAt) data.approvedAt = new Date();
    }

    if (body.role !== undefined) {
      const role = String(body.role);
      if (!["admin", "member"].includes(role)) {
        throw new HttpError(400, "Role must be admin or member.");
      }
      data.role = role;
    }

    // Force a new PIN for someone locked out. No current-PIN check — that's the
    // whole point — so every reset is audited and every live session of theirs is
    // dropped below, in case the lockout was somebody else holding the account.
    if (body.newPin !== undefined) {
      if (!isValidPin(body.newPin)) {
        throw new HttpError(400, `PIN must be ${PIN_LENGTH} digits.`);
      }
      data.password_hash = await hashPin(body.newPin);
    }

    if (Object.keys(data).length === 0) {
      throw new HttpError(400, "Nothing to update.");
    }

    const updated = await prisma.user.update({ where: { id }, data, select: SELECT });

    // resolveSession() would drop their logins on the next request anyway, but
    // doing it here makes revocation immediate rather than eventual.
    if ((data.status && data.status !== "active") || data.password_hash) {
      await prisma.session.deleteMany({ where: { userId: id } });
    }

    if (data.status) {
      await audit({
        actorId: admin.id,
        action: data.status === "active" ? "user.approve" : "user.reject",
        entity: "user",
        entityId: id,
        detail: { email: target.email },
      });
    }
    if (data.role) {
      await audit({
        actorId: admin.id,
        action: "user.role",
        entity: "user",
        entityId: id,
        detail: { role: data.role },
      });
    }
    if (data.password_hash) {
      await audit({
        actorId: admin.id,
        action: "user.pin.reset",
        entity: "user",
        entityId: id,
        detail: { email: target.email },
      });
    }

    return updated;
  });
}

/**
 * ADMIN ONLY — delete an account outright.
 *
 * Everything the account owns cascades: reminders, categories, history,
 * notifications, sessions, passkeys and push devices. There is no soft-delete, so
 * rejecting is the reversible option and this one is not.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return jsonAdmin(async (admin) => {
    const { id } = await ctx.params;
    if (id === admin.id) {
      throw new HttpError(400, "You can't delete your own account.");
    }
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!target) throw new HttpError(404, "Account not found");

    await prisma.user.delete({ where: { id } });
    await audit({
      actorId: admin.id,
      action: "user.delete",
      entity: "user",
      entityId: id,
    });
    return { deleted: true };
  });
}
