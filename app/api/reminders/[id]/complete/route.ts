import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json, readJson } from "@/lib/http";
import { computeNextDueAt } from "@/lib/reminder-logic";
import { assertReminderAction } from "@/lib/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INCLUDE = {
  category: true,
  family: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
} as const;

/**
 * Who settled this cycle already, phrased for the person who just tried to.
 *
 * Deliberately names them. "Already completed" on its own invites the reflex that
 * something went wrong; "Member Person marked this done" is the actual news, and on a
 * shared list it is the thing worth knowing.
 */
async function alreadyDone(reminderId: string, cycleDueAt: Date): Promise<HttpError> {
  const existing = await prisma.reminderHistory.findFirst({
    where: { reminderId, cycleDueAt },
    select: { completedOn: true, completedBy: { select: { name: true } } },
  });
  const who = existing?.completedBy?.name;
  return new HttpError(
    409,
    who
      ? `${who} already marked this done.`
      : "This one was already marked done for this cycle.",
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    const body = await readJson(req);
    // Assignee and family head may complete, not only the creator.
    const reminder = await assertReminderAction(id, user.id, "complete");

    // Which cycle is being settled. Sent by a client replaying a completion it queued
    // while offline — by then the reminder may have rolled forward, and without this
    // the replay would settle the *next* cycle instead of the one the user saw. An
    // ordinary online tap sends nothing and means the cycle currently due.
    let cycleDueAt = reminder.dueAt;
    if (body.cycleDueAt !== undefined) {
      const asked = new Date(String(body.cycleDueAt));
      if (Number.isNaN(asked.getTime())) {
        throw new HttpError(400, "cycleDueAt was not a date.");
      }
      cycleDueAt = asked;
    }

    // Checked here for the message, and enforced by a unique index for the race — two
    // people tapping Complete in the same second both passed this check and both wrote
    // a row, which counted the money twice.
    const settled = await prisma.reminderHistory.findFirst({
      where: { reminderId: id, cycleDueAt },
      select: { id: true },
    });
    if (settled) throw await alreadyDone(id, cycleDueAt);

    try {
      await prisma.reminderHistory.create({
        data: {
          reminderId: id,
          // Worth recording on a shared list: "who actually paid this".
          completedById: user.id,
          // The cycle this settles, captured *before* the update below rolls dueAt
          // forward. Afterwards the reminder only knows about its next occurrence, so
          // this is the one moment "was it done on time?" can still be answered.
          cycleDueAt,
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
    } catch (e) {
      // P2002 is the unique index above. It means somebody won the race between the
      // check and this insert, which is the same answer as finding the row already
      // there — so it is reported the same way rather than as a server fault.
      if ((e as { code?: string }).code === "P2002") throw await alreadyDone(id, cycleDueAt);
      throw e;
    }

    // Only reached once this cycle's history row is safely in — rolling dueAt forward
    // before writing it would let a duplicate tap advance the reminder twice and skip a
    // cycle outright. Rolled from the reminder's own dueAt rather than from cycleDueAt:
    // the two differ only when the due date was edited after the completion was queued,
    // and the edited date is the one the user last chose.
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
