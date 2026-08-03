import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { sanitizeReminderInput } from "@/lib/reminder-logic";
import { assertReminderAction, findVisibleReminder } from "@/lib/ownership";
import { assertReminderDestination } from "@/lib/reminder-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INCLUDE = {
  category: true,
  family: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
} as const;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    // Visibility only — any member of the family may read it.
    await findVisibleReminder(id, user.id);
    const reminder = await prisma.reminder.findUnique({
      where: { id },
      include: { ...INCLUDE, history: { orderBy: { completedOn: "desc" } } },
    });
    if (!reminder) throw new HttpError(404, "Reminder not found");
    return reminder;
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    const existing = await assertReminderAction(id, user.id, "edit");

    const body = await req.json();
    const data = sanitizeReminderInput(body, false, user.timezone, user.defaultTime);
    await assertReminderDestination(data, user.id, existing.familyId);

    // Moving a reminder between lists changes who hears about it, so stale
    // assignment and audience must not survive the move.
    if (data.familyId !== undefined && data.familyId !== existing.familyId) {
      if (data.assignedToId === undefined) data.assignedToId = null;
      if (data.audience === undefined) data.audience = "owner";
    }

    // Moving the due instant starts a fresh notification cycle: the dedupe rows
    // are keyed on the old dueAt, and any snooze/nag state no longer applies.
    if (data.dueAt !== undefined) {
      data.snoozedUntil = null;
      data.lastNaggedAt = null;
    }

    return prisma.reminder.update({
      where: { id },
      data: data as never,
      include: INCLUDE,
    });
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    await assertReminderAction(id, user.id, "edit");
    // ReminderHistory and ReminderDispatch cascade on delete; notifications are
    // only loosely linked (reminderId is nullable), so clear them explicitly —
    // for every recipient, not just the caller.
    await prisma.notification.deleteMany({ where: { reminderId: id } });
    return prisma.reminder.delete({ where: { id } });
  });
}
