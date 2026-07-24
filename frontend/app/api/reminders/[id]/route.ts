import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { assignedToSelect, sanitizeReminderInput } from "@/lib/reminder-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async () => {
    const { id } = await ctx.params;
    const reminder = await prisma.reminder.findUnique({
      where: { id },
      include: {
        category: true,
        assignedTo: { select: assignedToSelect },
        history: { orderBy: { completedOn: "desc" } },
      },
    });
    if (!reminder) throw new HttpError(404, "Reminder not found");
    return reminder;
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async () => {
    const { id } = await ctx.params;
    const body = await req.json();
    return prisma.reminder.update({
      where: { id },
      data: sanitizeReminderInput(body, false) as never,
      include: { category: true, assignedTo: { select: assignedToSelect } },
    });
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async () => {
    const { id } = await ctx.params;
    await prisma.reminderHistory.deleteMany({ where: { reminderId: id } });
    await prisma.notification.deleteMany({ where: { reminderId: id } });
    return prisma.reminder.delete({ where: { id } });
  });
}
