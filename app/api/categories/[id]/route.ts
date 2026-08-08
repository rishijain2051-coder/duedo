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
    const category = await findWritable(id, user.id);
    const body = await readJson(req);

    // Renaming went straight to the database with whatever arrived. Three things came
    // out of that, and POST already got all three right:
    //
    //   * an untrimmed name stored the spaces, so "Bills" and "Bills " sat side by side
    //     as two categories that read identically;
    //   * an empty string passed `?? undefined` — only null and undefined are caught —
    //     and blanked the name outright;
    //   * a name already taken in the same scope hit the unique index, and P2002 came
    //     back as a 500 with a Prisma message in it. The user saw "Internal server
    //     error" for the ordinary mistake of reusing a name.
    let name: string | undefined;
    if (body.name !== undefined) {
      name = String(body.name).trim();
      if (!name) throw new HttpError(400, "Name is required");

      // Scoped exactly as POST scopes it: a category belongs to a person or a family,
      // never both, so the clash is only ever within its own list.
      const scope = category.familyId
        ? { familyId: category.familyId }
        : { userId: category.userId };
      const clash = await prisma.category.findFirst({
        where: { ...scope, name, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        throw new HttpError(
          409,
          category.familyId
            ? "This family already has a category with that name."
            : "You already have a category with that name.",
        );
      }
    }

    return prisma.category.update({
      where: { id },
      data: {
        name,
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
