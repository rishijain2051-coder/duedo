import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json, HttpError, readJson } from "@/lib/http";
import { assertHead, uniqueJoinCode } from "@/lib/families";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Head-only family administration: rename, rotate the join code, hand over
 * headship.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    await assertHead(user.id, id);
    const body = await readJson(req);

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 2) throw new HttpError(400, "Give the family a name.");
      await prisma.family.update({ where: { id }, data: { name } });
      await audit({
        actorId: user.id,
        action: "family.rename",
        entity: "family",
        entityId: id,
        detail: { name },
      });
    }

    // What the family opts into. Head-only, and every one of them defaults off except
    // the monthly mail to the head — see the note on the Family model. Grouped rather
    // than handled one field at a time because they are a single decision in the UI.
    const FLAGS = ["showRanking", "showStreaks", "allowNudges", "monthlyReportToHead"] as const;
    const flags: Record<string, boolean> = {};
    for (const flag of FLAGS) {
      if (body[flag] !== undefined) flags[flag] = body[flag] === true;
    }
    if (Object.keys(flags).length > 0) {
      await prisma.family.update({ where: { id }, data: flags });
      await audit({
        actorId: user.id,
        action: "family.settings",
        entity: "family",
        entityId: id,
        detail: flags,
      });
    }

    if (body.rotateCode === true) {
      const joinCode = await uniqueJoinCode();
      await prisma.family.update({ where: { id }, data: { joinCode } });
      await audit({
        actorId: user.id,
        action: "family.code.rotate",
        entity: "family",
        entityId: id,
      });
    }

    if (body.transferHeadTo !== undefined) {
      const targetId = String(body.transferHeadTo);
      if (targetId === user.id) throw new HttpError(400, "You're already the head.");
      const target = await prisma.familyMember.findUnique({
        where: { familyId_userId: { familyId: id, userId: targetId } },
        select: { id: true },
      });
      if (!target) throw new HttpError(400, "That person isn't in this family.");

      // Both rows move together: a family with two heads or none would be a
      // permission hole either way.
      await prisma.$transaction([
        prisma.familyMember.update({
          where: { familyId_userId: { familyId: id, userId: targetId } },
          data: { role: "head" },
        }),
        prisma.familyMember.update({
          where: { familyId_userId: { familyId: id, userId: user.id } },
          data: { role: "member" },
        }),
      ]);
      await audit({
        actorId: user.id,
        action: "family.head.transfer",
        entity: "family",
        entityId: id,
        detail: { to: targetId },
      });
    }

    const family = await prisma.family.findUniqueOrThrow({
      where: { id },
      select: { id: true, name: true, joinCode: true },
    });
    const stillHead = await prisma.familyMember.findUnique({
      where: { familyId_userId: { familyId: id, userId: user.id } },
      select: { role: true },
    });
    return { ...family, role: stillHead?.role ?? "member" };
  });
}

/**
 * Dissolves a family. **Refused while any reminder still sits on its shared
 * list** — the head clears or moves them first.
 *
 * That is deliberately the whole rule: there is no "delete them too" and no
 * "hand them to the head", so dissolving can never destroy something somebody
 * else was relying on, and there is no orphan case to reason about.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    await assertHead(user.id, id);

    const remaining = await prisma.reminder.count({ where: { familyId: id } });
    if (remaining > 0) {
      throw new HttpError(
        409,
        `This family still has ${remaining} reminder${remaining === 1 ? "" : "s"} on its shared list. Move or delete them first.`,
      );
    }

    const family = await prisma.family.findUniqueOrThrow({
      where: { id },
      select: { name: true, _count: { select: { members: true } } },
    });

    // Members and the family's own categories cascade.
    await prisma.family.delete({ where: { id } });

    await audit({
      actorId: user.id,
      action: "family.dissolve",
      entity: "family",
      entityId: id,
      detail: { name: family.name, members: family._count.members },
    });

    return { deleted: true };
  });
}
