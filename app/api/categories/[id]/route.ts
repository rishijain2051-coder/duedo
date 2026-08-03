import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The caller's category, or 404 — never another account's. */
async function findOwned(id: string, userId: string) {
  const category = await prisma.category.findFirst({ where: { id, userId } });
  if (!category) throw new HttpError(404, "Category not found");
  return category;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    await findOwned(id, user.id);
    const body = await req.json();

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
    await findOwned(id, user.id);

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
