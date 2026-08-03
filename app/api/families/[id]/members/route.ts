import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json, HttpError } from "@/lib/http";
import { assertMember } from "@/lib/families";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE ?userId=<id>  the head removes a member
 * DELETE               the caller leaves the family
 *
 * A head cannot leave or be removed while anyone else is still in the family —
 * they must hand headship over first. Otherwise a family would be left with no
 * one able to approve joins, rotate the code or dissolve it.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    const me = await assertMember(user.id, id);

    const targetId = req.nextUrl.searchParams.get("userId") || user.id;
    const leavingSelf = targetId === user.id;

    if (!leavingSelf && me.role !== "head") {
      throw new HttpError(403, "Only the family head can remove someone.");
    }

    const target = await prisma.familyMember.findUnique({
      where: { familyId_userId: { familyId: id, userId: targetId } },
      include: { user: { select: { name: true } } },
    });
    if (!target) throw new HttpError(404, "That person isn't in this family.");

    if (target.role === "head") {
      const others = await prisma.familyMember.count({
        where: { familyId: id, userId: { not: targetId } },
      });
      if (others > 0) {
        throw new HttpError(
          409,
          "Hand over headship to another member first, then leave.",
        );
      }
    }

    // Their reminders stay on the family list — they belong to the family, and
    // deleting someone else's work as a side effect of a membership change would
    // be a nasty surprise. Assignments pointing at them are cleared, since an
    // assignee who isn't a member would never be notified.
    await prisma.$transaction([
      prisma.reminder.updateMany({
        where: { familyId: id, assignedToId: targetId },
        data: { assignedToId: null },
      }),
      prisma.familyMember.delete({
        where: { familyId_userId: { familyId: id, userId: targetId } },
      }),
      // Clear any old decision so they can ask to rejoin later.
      prisma.familyJoinRequest.deleteMany({ where: { familyId: id, userId: targetId } }),
    ]);

    await audit({
      actorId: user.id,
      action: leavingSelf ? "family.member.leave" : "family.member.remove",
      entity: "family",
      entityId: id,
      detail: { userId: targetId },
    });

    return { removed: true, name: target.user.name, self: leavingSelf };
  });
}
