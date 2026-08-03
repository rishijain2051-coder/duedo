import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { findOwnedReminder } from "@/lib/ownership";
import { SNOOZE_OPTIONS } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = SNOOZE_OPTIONS.map((o) => o.minutes) as readonly number[];

/**
 * Suppresses all alerts for a reminder for a while. Reachable from the Snooze
 * action on the notification itself, which is why it tolerates a bodyless POST.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const minutes = Number(body.minutes ?? 60);
    if (!ALLOWED.includes(minutes)) {
      throw new HttpError(400, `Snooze must be one of: ${ALLOWED.join(", ")} minutes.`);
    }

    await findOwnedReminder(id, user.id);

    const until = new Date(Date.now() + minutes * 60_000);
    return prisma.reminder.update({
      where: { id },
      // lastNaggedAt is advanced too, so the overdue interval restarts from the
      // end of the snooze rather than firing the moment it lapses.
      data: { snoozedUntil: until, lastNaggedAt: until },
      include: { category: true },
    });
  });
}
