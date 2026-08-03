import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { sanitizeReminderInput } from "@/lib/reminder-logic";
import { assertOwnedCategory, findOwnedReminder } from "@/lib/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    const reminder = await prisma.reminder.findFirst({
      where: { id, userId: user.id },
      include: {
        category: true,
        history: { orderBy: { completedOn: "desc" } },
      },
    });
    if (!reminder) throw new HttpError(404, "Reminder not found");
    return reminder;
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    await findOwnedReminder(id, user.id);

    const body = await req.json();
    const data = sanitizeReminderInput(body, false, user.timezone, user.defaultTime);
    if (data.categoryId !== undefined) {
      await assertOwnedCategory(data.categoryId, user.id);
    }

    // Moving the due instant starts a fresh notification cycle: the dedupe rows
    // are keyed on the old dueAt, and any snooze/nag state no longer applies.
    if (data.dueAt !== undefined) {
      data.snoozedUntil = null;
      data.lastNaggedAt = null;
      data.lastEmailedAt = null;
    }

    return prisma.reminder.update({
      where: { id },
      data: data as never,
      include: { category: true },
    });
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    await findOwnedReminder(id, user.id);
    // ReminderHistory and ReminderDispatch cascade on delete; notifications are
    // only loosely linked (reminderId is nullable), so clear them explicitly.
    await prisma.notification.deleteMany({ where: { reminderId: id } });
    return prisma.reminder.delete({ where: { id } });
  });
}
