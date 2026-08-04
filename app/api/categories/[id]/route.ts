import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json, readJson } from "@/lib/http";
import { membershipIn } from "@/lib/families";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A category the caller may change: their own, or one belonging to a family where
 * they are the head.
 *
 * A plain member can *use* the family's categories but not rename or delete them —
 * renaming a shared category changes it for everyone, which is head territory.
 */
async function findWritable(id: string, userId: string) {
  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) throw new HttpError(404, "Category not found");

  if (category.userId === userId) return category;

  if (category.familyId) {
    const membership = await membershipIn(userId, category.familyId);
    if (!membership) throw new HttpError(404, "Category not found");
    if (membership.role !== "head") {
      throw new HttpError(403, "Only the family head can change a shared category.");
    }
    return category;
  }

  throw new HttpError(404, "Category not found");
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    await findWritable(id, user.id);
    const body = await readJson(req);

    return prisma.category.update({
      where: { id },
      data: {
        name: body.name ?? undefined,
        icon: body.icon ?? undefined,
        color: body.color ?? undefined,
      },
    });
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    await findWritable(id, user.id);

    const inUse = await prisma.reminder.count({ where: { categoryId: id } });
    if (inUse > 0) {
      return {
        deleted: false,
        message: `Category is used by ${inUse} reminder(s). Reassign them first.`,
      };
    }
    await prisma.category.delete({ where: { id } });
    return { deleted: true };
  });
}
