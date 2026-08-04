import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { findVisibleReminder } from "@/lib/ownership";
import { sendPushToUser } from "@/lib/push";
import { formatDateTime } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One nudge per reminder per this long, per sender. */
const COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * "Are you still doing this?", sent by a person rather than by the engine.
 *
 * This is the one feature here where one member deliberately makes another member's phone
 * buzz, so it comes with three constraints rather than one:
 *
 *   * off unless the family head has switched `allowNudges` on — a household that doesn't
 *     want to be nudged shouldn't have to ask each other not to;
 *   * only for something already overdue, so it can't be used to hurry someone along
 *     before the date they were given;
 *   * rate-limited per reminder, because a feature that can be pressed repeatedly is a
 *     feature that will be.
 *
 * The cooldown is derived from the notification already on record rather than a new
 * column: the nudge writes a Notification like any other alert, so the last one's
 * timestamp is the rate limit.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    const reminder = await findVisibleReminder(id, user.id);
    if (!reminder) throw new HttpError(404, "Not found");
    if (!reminder.familyId) throw new HttpError(400, "Nobody else to nudge.");

    const family = await prisma.family.findUniqueOrThrow({
      where: { id: reminder.familyId },
      select: { allowNudges: true, name: true },
    });
    if (!family.allowNudges) {
      throw new HttpError(403, `${family.name} has nudges switched off.`);
    }

    const target = reminder.assignedToId;
    if (!target) throw new HttpError(400, "Nobody is assigned to this one.");
    if (target === user.id) throw new HttpError(400, "That one is yours already.");
    if (reminder.dueAt > new Date()) {
      throw new HttpError(400, "It isn't overdue yet.");
    }
    if (reminder.acknowledgedAt) {
      throw new HttpError(400, "Someone has already said they'll handle it.");
    }

    const recent = await prisma.notification.findFirst({
      where: {
        userId: target,
        reminderId: id,
        kind: "nudge",
        createdAt: { gte: new Date(Date.now() - COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (recent) throw new HttpError(429, "Already nudged recently. Give it a few hours.");

    const recipient = await prisma.user.findUniqueOrThrow({
      where: { id: target },
      select: { name: true, timezone: true, pushOptIn: true },
    });

    const title = `${user.name} is asking about ${reminder.title}`;
    const body = `Still due — ${formatDateTime(reminder.dueAt, reminder.hasTime, recipient.timezone)}`;

    // Recorded whether or not the push lands, same as every other alert: the in-app feed
    // is the channel that always works, and it is also what enforces the cooldown.
    await prisma.notification.create({
      data: { userId: target, reminderId: id, title, body, kind: "nudge" },
    });

    let pushed = 0;
    if (recipient.pushOptIn) {
      const res = await sendPushToUser(target, {
        title,
        body,
        tag: `nudge-${id}`,
        kind: "nudge",
        reminderId: id,
        url: "/reminders",
      });
      pushed = res.sent;
    }

    return { nudged: recipient.name, pushed };
  }, 201);
}
