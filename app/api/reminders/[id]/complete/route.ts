import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json, readJson } from "@/lib/http";
import { computeNextDueAt } from "@/lib/reminder-logic";
import { assertReminderAction } from "@/lib/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INCLUDE = {
  category: true,
  family: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
} as const;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    const body = await readJson(req);
    // Assignee and family head may complete, not only the creator.
    const reminder = await assertReminderAction(id, user.id, "complete");

    await prisma.reminderHistory.create({
      data: {
        reminderId: id,
        // Worth recording on a shared list: "who actually paid this".
        completedById: user.id,
        // The cycle this settles, captured *before* the update below rolls dueAt
        // forward. Afterwards the reminder only knows about its next occurrence, so
        // this is the one moment "was it done on time?" can still be answered.
        cycleDueAt: reminder.dueAt,
        // Omitted, or a figure that isn't a number, falls back to what the
        // reminder said — rather than reaching the database as NaN and failing the
        // whole save over a stray character in one field.
        amount:
          body.amount == null || !Number.isFinite(Number(body.amount))
            ? reminder.amount
            : Number(body.amount),
        status: "completed",
        remarks: typeof body.remarks === "string" ? body.remarks : null,
      },
    });

    const next = computeNextDueAt(reminder.dueAt, reminder.recurrenceRule);

    // Either way the nag state is cleared. For a recurring reminder the new dueAt
    // also gives ReminderDispatch a new cycleDueAt, so the whole set of lead/due
    // notifications re-arms by itself — for every recipient.
    return prisma.reminder.update({
      where: { id },
      data: next
        ? {
            dueAt: next,
            status: "active",
            snoozedUntil: null,
            lastNaggedAt: null,
            completedAt: null,
            // A new cycle has nobody on the hook for it yet.
            acknowledgedAt: null,
            acknowledgedById: null,
          }
        : {
            status: "completed",
            completedAt: new Date(),
            snoozedUntil: null,
            lastNaggedAt: null,
            acknowledgedAt: null,
            acknowledgedById: null,
          },
      include: INCLUDE,
    });
  });
}
