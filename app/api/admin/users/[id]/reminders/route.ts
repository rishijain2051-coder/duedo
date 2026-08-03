import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, jsonAdmin } from "@/lib/http";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One account's reminders, content included, for support.
 *
 * This is the deliberate exception to "private per account": admins were given
 * full read access on purpose. It is confined to this one route so the boundary
 * stays visible — the ordinary reminder routes never let an admin past their own
 * scope — and **every call is audited**, which is what keeps the power
 * accountable rather than ambient.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return jsonAdmin(async (admin) => {
    const { id } = await ctx.params;
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!target) throw new HttpError(404, "Account not found");

    const reminders = await prisma.reminder.findMany({
      where: { userId: id },
      include: {
        category: true,
        family: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
      orderBy: { dueAt: "asc" },
    });

    await audit({
      actorId: admin.id,
      action: "admin.read.reminders",
      entity: "user",
      entityId: id,
      detail: { name: target.name, count: reminders.length },
    });

    return reminders;
  });
}
