import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, jsonAdmin, readJson } from "@/lib/http";
import { hashPin, isValidPin, PIN_LENGTH } from "@/lib/pin";
import { audit } from "@/lib/audit";
import { isPlanId } from "@/lib/plan";

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
  isRootAdmin: true,
  plan: true,
  premiumUntil: true,
  planNote: true,
  approvedAt: true,
  emailVerifiedAt: true,
  createdAt: true,
} as const;

/** A grant of a year, a month, or anything else the owner types. Bounded both ways. */
const MAX_GRANT_DAYS = 3660; // ten years; anything larger is a typo, not a decision
const MAX_NOTE = 200;

/**
 * ADMIN ONLY — approve, reject, or change the role of another account.
 *
 * Two rules keep the install from being stranded, and between them no counting of
 * admins is needed anywhere:
 *
 *   * an admin may never act on their own row, so the acting admin always survives
 *     whatever they just did;
 *   * the root row — the install's owner — is untouchable by anyone else, so an admin
 *     it promoted cannot turn round and lock it out.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return jsonAdmin(async (admin) => {
    const { id } = await ctx.params;
    const body = await readJson(req);

    // Billing, handled before every rule below, because none of them apply to it.
    //
    // Access is granted by hand — there is no checkout — so this is the whole payment
    // system: money arrives over UPI, the owner types how long it bought, and the date
    // does the expiring. Two of the guards further down are deliberately not in force
    // here:
    //
    //   * the self rule. It exists so an admin cannot demote or lock out their own
    //     account; extending your own access cannot strand the install, and the owner
    //     is the one person certain to need a plan (they have the family);
    //   * the root-row rule. It stops an admin turning on the account that promoted
    //     them, and a grant is root-only anyway, so there is nobody it protects here.
    //
    // Root-only, though, and not merely admin. This is revenue: an admin promoted later
    // should not be able to hand out paid access, to themselves or to anyone.
    if (body.plan !== undefined || body.addDays !== undefined || body.clearPremium) {
      if (!admin.isRootAdmin) {
        throw new HttpError(403, "Only the install's owner can change a plan.");
      }
      return grantPlan(admin.id, id, body);
    }

    if (id === admin.id) {
      throw new HttpError(
        400,
        "You can't change your own account here — use Settings for your profile.",
      );
    }

    const target = await prisma.user.findUnique({ where: { id }, select: SELECT });
    if (!target) throw new HttpError(404, "Account not found");

    // Handing over ownership. Only the holder can give it away, and only to an admin
    // who is actually able to use it — an inactive one would leave the flag stranded
    // on a row that can't sign in. Both writes are one transaction so the install is
    // never momentarily ownerless.
    if (body.makeRoot !== undefined) {
      if (body.makeRoot !== true) {
        throw new HttpError(400, "makeRoot can only be true.");
      }
      if (!admin.isRootAdmin) {
        throw new HttpError(403, "Only the root admin can hand over ownership.");
      }
      if (target.role !== "admin" || target.status !== "active") {
        throw new HttpError(400, "Ownership can only pass to an active admin.");
      }
      await prisma.$transaction([
        prisma.user.update({ where: { id: admin.id }, data: { isRootAdmin: false } }),
        prisma.user.update({ where: { id }, data: { isRootAdmin: true } }),
      ]);
      await audit({
        actorId: admin.id,
        action: "user.root.transfer",
        entity: "user",
        entityId: id,
        detail: { to: target.email },
      });
      return { ...target, isRootAdmin: true };
    }

    if (target.isRootAdmin) {
      throw new HttpError(
        403,
        "That account is the install's owner — only it can change its own role, access or PIN, from Settings.",
      );
    }

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
 * ROOT ADMIN ONLY — grant, extend or withdraw paid access.
 *
 * `addDays` stacks from whichever is later, today or the current expiry. Both cases
 * are the obvious one once written down: someone renewing three days early should get
 * their remaining three days *plus* the year, and someone who lapsed in March should
 * get a year from today rather than from March, which would hand them a date already
 * in the past.
 */
async function grantPlan(actorId: string, id: string, body: Record<string, unknown>) {
  const target = await prisma.user.findUnique({ where: { id }, select: SELECT });
  if (!target) throw new HttpError(404, "Account not found");

  const data: {
    plan?: string;
    premiumUntil?: Date | null;
    planNote?: string | null;
  } = {};

  if (body.clearPremium) {
    // Withdrawal, for a refund or a mistake. Not the same as letting it lapse, and
    // deliberately available: without it a typo of 3660 days is uncorrectable.
    data.plan = "free";
    data.premiumUntil = null;
  } else {
    if (body.plan !== undefined) {
      if (!isPlanId(body.plan)) {
        throw new HttpError(400, "plan must be free, individual or family.");
      }
      data.plan = body.plan;
      if (body.plan === "free") data.premiumUntil = null;
    }

    if (body.addDays !== undefined) {
      const days = Number(body.addDays);
      if (!Number.isInteger(days) || days <= 0 || days > MAX_GRANT_DAYS) {
        throw new HttpError(
          400,
          `addDays must be a whole number of days between 1 and ${MAX_GRANT_DAYS}.`,
        );
      }
      const now = new Date();
      const from =
        target.premiumUntil && target.premiumUntil > now ? target.premiumUntil : now;
      data.premiumUntil = new Date(from.getTime() + days * 86_400_000);
    }
  }

  if (body.planNote !== undefined) {
    const note = String(body.planNote).trim().slice(0, MAX_NOTE);
    data.planNote = note || null;
  }

  if (Object.keys(data).length === 0) {
    throw new HttpError(400, "Nothing to change.");
  }

  // A date without a plan buys nothing — effectivePlan reads the two together and
  // "free until next March" is still free. Caught here rather than left as a grant
  // that appears to have worked and silently didn't.
  const endPlan = data.plan ?? target.plan;
  const endUntil = data.premiumUntil !== undefined ? data.premiumUntil : target.premiumUntil;
  if (endPlan === "free" && endUntil && endUntil > new Date()) {
    throw new HttpError(400, "Pick a paid plan as well — a date alone changes nothing.");
  }

  const updated = await prisma.user.update({ where: { id }, data, select: SELECT });

  await audit({
    actorId,
    action: data.premiumUntil === null && data.plan === "free" ? "plan.revoke" : "plan.grant",
    entity: "user",
    entityId: id,
    detail: {
      email: target.email,
      plan: updated.plan,
      // Both ends recorded, because "extended by a year" is only checkable against
      // where it started. This entry plus the note is the entire paper trail behind a
      // payment, and six months on it is the only answer to "I paid you in March".
      from: target.premiumUntil?.toISOString() ?? null,
      to: updated.premiumUntil?.toISOString() ?? null,
      note: updated.planNote,
    },
  });

  return updated;
}

/**
 * ADMIN ONLY — delete an account outright.
 *
 * Everything the account owns cascades: reminders, categories, history,
 * notifications, sessions, passkeys and push devices. There is no soft-delete, so
 * rejecting is the reversible option and this one is not.
 *
 * The one thing the cascade cannot reach is other people's notifications about this
 * account's reminders, which is why they are cleared first.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return jsonAdmin(async (admin) => {
    const { id } = await ctx.params;
    if (id === admin.id) {
      throw new HttpError(400, "You can't delete your own account.");
    }
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, isRootAdmin: true },
    });
    if (!target) throw new HttpError(404, "Account not found");
    if (target.isRootAdmin) {
      throw new HttpError(403, "The install's owner cannot be deleted.");
    }

    // Notification.reminderId is a bare String? with an index and no foreign key, so
    // nothing in the database cleans it up. DELETE /api/reminders/:id clears them for
    // the direct case; this is the one cascade that gets past that — other members of
    // this account's families hold notifications about reminders it created, and the
    // cascade takes the reminders while leaving those entries naming something nobody
    // can open. Read the ids while they still exist, then delete.
    //
    // Dissolving a family is not a third case: both dissolve routes refuse while the
    // shared list still holds reminders, so nothing cascades there.
    const owned = await prisma.reminder.findMany({
      where: { userId: id },
      select: { id: true },
    });
    if (owned.length > 0) {
      await prisma.notification.deleteMany({
        where: { reminderId: { in: owned.map((r) => r.id) } },
      });
    }

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
