import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { findVisibleReminder } from "@/lib/ownership";
import { recipientsFor } from "@/lib/recipients";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "I'll handle it."
 *
 * The gap this closes is specific: on a shared list, everyone can see a bill is due and
 * nobody can see whether anyone is dealing with it. The alternative is a message in
 * another app, which is exactly the back-and-forth a shared list was supposed to remove.
 *
 * Only a *recipient* may acknowledge — the people the alert actually went to. A family
 * member who was never notified saying they have it would be a claim about something
 * they haven't seen.
 *
 * One acknowledgment per cycle, not one per person. The question is "is anyone on this?",
 * and a list of everyone who tapped it answers a question nobody asked.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    const reminder = await findVisibleReminder(id, user.id);
    if (!reminder) throw new HttpError(404, "Not found");

    if (!reminder.familyId) {
      throw new HttpError(
        400,
        "A personal reminder is already yours — there is nobody to tell.",
      );
    }

    const recipients = await recipientsFor(reminder);
    if (!recipients.includes(user.id)) {
      throw new HttpError(403, "This one wasn't addressed to you.");
    }

    // First one wins, and it stays. Re-tapping returns the existing state rather than
    // moving the credit to whoever pressed last.
    if (reminder.acknowledgedAt) {
      return {
        acknowledgedAt: reminder.acknowledgedAt,
        acknowledgedById: reminder.acknowledgedById,
        alreadyAcknowledged: true,
      };
    }

    const updated = await prisma.reminder.update({
      where: { id },
      data: { acknowledgedAt: new Date(), acknowledgedById: user.id },
      select: { acknowledgedAt: true, acknowledgedById: true },
    });

    await audit({
      actorId: user.id,
      action: "reminder.acknowledge",
      entity: "reminder",
      entityId: id,
    });

    return { ...updated, alreadyAcknowledged: false };
  });
}

/** Taking it back, for the "sorry, I can't after all" case. Only whoever claimed it. */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return json(async (user) => {
    const { id } = await ctx.params;
    const reminder = await findVisibleReminder(id, user.id);
    if (!reminder) throw new HttpError(404, "Not found");
    if (!reminder.acknowledgedAt) return { acknowledgedAt: null, acknowledgedById: null };
    if (reminder.acknowledgedById !== user.id) {
      throw new HttpError(403, "Only the person who claimed it can hand it back.");
    }
    return prisma.reminder.update({
      where: { id },
      data: { acknowledgedAt: null, acknowledgedById: null },
      select: { acknowledgedAt: true, acknowledgedById: true },
    });
  });
}
