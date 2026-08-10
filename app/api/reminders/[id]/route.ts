import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json, readJson } from "@/lib/http";
import { sanitizeReminderInput } from "@/lib/reminder-logic";
import { assertReminderAction, findVisibleReminder } from "@/lib/ownership";
import { assertReminderDestination, assertReminderFields } from "@/lib/reminder-scope";
import { clearDispatchLedger } from "@/lib/dispatch";
import { REMINDER_INCLUDE } from "@/lib/reminder-shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    // Visibility only — any member of the family may read it.
    await findVisibleReminder(id, user.id);
    const reminder = await prisma.reminder.findUnique({
      where: { id },
      include: { ...REMINDER_INCLUDE, history: { orderBy: { completedOn: "desc" } } },
    });
    if (!reminder) throw new HttpError(404, "Reminder not found");
    return reminder;
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    const existing = await assertReminderAction(id, user.id, "edit");

    const body = await readJson(req);

    /**
     * Last-write-wins, unless the writer is working from a version that has since
     * been overtaken.
     *
     * `basedOn` is the updatedAt the edit was composed against — sent by a client
     * replaying an edit it queued while offline, where minutes or days may have
     * passed. Every other conflict in this app is detectable after the fact: a
     * double completion shows two rows, a lost snooze shows the alert arriving. A
     * silently overwritten edit shows nothing at all, which is why this is the one
     * that is refused rather than merged.
     *
     * updatedAt already exists and already changes on every write, so it is the
     * version token; no column was added for this.
     */
    if (body.basedOn !== undefined && body.basedOn !== null) {
      const basedOn = new Date(String(body.basedOn));
      if (Number.isNaN(basedOn.getTime())) {
        throw new HttpError(400, "basedOn was not a date.");
      }
      // Millisecond precision on both sides, so an unchanged row compares equal.
      if (existing.updatedAt.getTime() > basedOn.getTime()) {
        throw new HttpError(
          409,
          "This reminder changed on another device after you edited it, so nothing was overwritten. Open it again to see the current version.",
        );
      }
    }

    const data = sanitizeReminderInput(body, false, user.timezone);
    assertReminderFields(data, false);
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

    // The rows keyed on the old cycle are now unreachable, so they are removed rather
    // than left for a sweep. Also on a status change, which is how a reminder gets
    // abandoned without ever being completed — an archived one would otherwise hold its
    // due row for as long as the install lasts, since only completion clears it.
    const movedOn =
      data.dueAt !== undefined || (data.status !== undefined && data.status !== existing.status);
    if (movedOn) await clearDispatchLedger(id);

    return prisma.reminder.update({
      where: { id },
      data: data as never,
      include: REMINDER_INCLUDE,
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
