import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { assertReminderAction } from "@/lib/ownership";
import { SNOOZE_OPTIONS } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = SNOOZE_OPTIONS.map((o) => o.minutes) as readonly number[];

/**
 * Suppresses alerts for a reminder for a while. Reachable from the Snooze action
 * on the notification itself, which is why it tolerates a bodyless POST.
 *
 * On a family reminder this silences it for *everyone*, which is why it needs the
 * same permission as completing rather than merely being able to see it.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const minutes = Number(body.minutes ?? 60);
    if (!ALLOWED.includes(minutes)) {
      throw new HttpError(400, `Snooze must be one of: ${ALLOWED.join(", ")} minutes.`);
    }

    await assertReminderAction(id, user.id, "complete");

    const until = new Date(Date.now() + minutes * 60_000);
    return prisma.reminder.update({
      where: { id },
      // lastNaggedAt is advanced too, so the overdue interval restarts from the
      // end of the snooze rather than firing the moment it lapses.
      data: { snoozedUntil: until, lastNaggedAt: until },
      include: {
        category: true,
        family: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
  });
}
