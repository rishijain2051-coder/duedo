import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, jsonAdmin, readJson } from "@/lib/http";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHAPE = {
  members: {
    orderBy: { joinedAt: "asc" as const },
    include: { user: { select: { id: true, name: true, email: true } } },
  },
  _count: { select: { reminders: true } },
} as const;

async function shape(id: string) {
  const f = await prisma.family.findUniqueOrThrow({
    where: { id },
    include: SHAPE,
  });
  return {
    id: f.id,
    name: f.name,
    joinCode: f.joinCode,
    createdAt: f.createdAt,
    reminderCount: f._count.reminders,
    members: f.members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    })),
  };
}

/**
 * Admin family management: rename, force a new head, remove a member.
 *
 * Unlike the head-facing route this doesn't require membership — an admin can fix
 * a family they aren't in, which is the point of having the panel. Each action is
 * audited, because acting on somebody else's household should leave a trace.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return jsonAdmin(async (admin) => {
    const { id } = await ctx.params;
    const exists = await prisma.family.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new HttpError(404, "Family not found");

    const body = await readJson(req);

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 2) throw new HttpError(400, "Give the family a name.");
      await prisma.family.update({ where: { id }, data: { name } });
      await audit({
        actorId: admin.id,
        action: "family.rename",
        entity: "family",
        entityId: id,
        detail: { name, byAdmin: true },
      });
    }

    if (body.headId !== undefined) {
      const targetId = String(body.headId);
      const target = await prisma.familyMember.findUnique({
        where: { familyId_userId: { familyId: id, userId: targetId } },
        select: { id: true },
      });
      if (!target) throw new HttpError(400, "That person isn't in this family.");
      // Demote every current head, then promote one. Two heads is a permission
      // hole; zero heads is a family nobody can administer.
      await prisma.$transaction([
        prisma.familyMember.updateMany({
          where: { familyId: id, role: "head" },
          data: { role: "member" },
        }),
        prisma.familyMember.update({
          where: { familyId_userId: { familyId: id, userId: targetId } },
          data: { role: "head" },
        }),
      ]);
      await audit({
        actorId: admin.id,
        action: "family.head.transfer",
        entity: "family",
        entityId: id,
        detail: { to: targetId, byAdmin: true },
      });
    }

    if (body.removeUserId !== undefined) {
      const targetId = String(body.removeUserId);
      const target = await prisma.familyMember.findUnique({
        where: { familyId_userId: { familyId: id, userId: targetId } },
        select: { role: true },
      });
      if (!target) throw new HttpError(400, "That person isn't in this family.");

      const others = await prisma.familyMember.count({
        where: { familyId: id, userId: { not: targetId } },
      });
      if (target.role === "head" && others > 0) {
        throw new HttpError(409, "Appoint a different head before removing this one.");
      }

      await prisma.$transaction([
        prisma.reminder.updateMany({
          where: { familyId: id, assignedToId: targetId },
          data: { assignedToId: null },
        }),
        prisma.familyMember.delete({
          where: { familyId_userId: { familyId: id, userId: targetId } },
        }),
        prisma.familyJoinRequest.deleteMany({ where: { familyId: id, userId: targetId } }),
      ]);
      await audit({
        actorId: admin.id,
        action: "family.member.remove",
        entity: "family",
        entityId: id,
        detail: { userId: targetId, byAdmin: true },
      });
    }

    return shape(id);
  });
}

/**
 * Dissolves a family. Same rule as the head-facing route: refused while its
 * shared list still has reminders on it, so nothing is destroyed as a side
 * effect. An admin's convenience isn't worth a silent data loss.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return jsonAdmin(async (admin) => {
    const { id } = await ctx.params;
    const family = await prisma.family.findUnique({
      where: { id },
      select: { name: true, _count: { select: { reminders: true, members: true } } },
    });
    if (!family) throw new HttpError(404, "Family not found");

    if (family._count.reminders > 0) {
      throw new HttpError(
        409,
        `This family still has ${family._count.reminders} reminder${family._count.reminders === 1 ? "" : "s"} on its shared list. Clear them first.`,
      );
    }

    await prisma.family.delete({ where: { id } });
    await audit({
      actorId: admin.id,
      action: "family.dissolve",
      entity: "family",
      entityId: id,
      detail: { name: family.name, members: family._count.members, byAdmin: true },
    });
    return { deleted: true };
  });
}
