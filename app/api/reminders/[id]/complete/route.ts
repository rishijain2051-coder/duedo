import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { assignedToSelect, computeNextDueDate } from "@/lib/reminder-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async () => {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const reminder = await prisma.reminder.findUnique({ where: { id } });
    if (!reminder) throw new HttpError(404, "Reminder not found");

    await prisma.reminderHistory.create({
      data: {
        reminderId: id,
        amount: body.amount != null ? Number(body.amount) : reminder.amount,
        status: "completed",
        remarks: body.remarks ?? null,
      },
    });

    const next = computeNextDueDate(reminder.dueDate, reminder.recurrenceRule);
    if (next) {
      return prisma.reminder.update({
        where: { id },
        data: { dueDate: next, nextDueDate: null, status: "active" },
        include: { category: true, assignedTo: { select: assignedToSelect } },
      });
    }
    return prisma.reminder.update({
      where: { id },
      data: { status: "completed" },
      include: { category: true, assignedTo: { select: assignedToSelect } },
    });
  });
}
