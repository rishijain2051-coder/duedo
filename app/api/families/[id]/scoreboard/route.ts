import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { assertMember } from "@/lib/families";
import { zonedMonthStart, zonedMonthStartOffset } from "@/lib/time";
import { memberStats, orderMembers } from "@/lib/scoreboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who is keeping up with what they were given.
 *
 * The definitions live in lib/scoreboard.ts, shared with the monthly email so the two can
 * never drift apart.
 *
 * What comes back depends on the family's own settings. Ranking and streaks are off until
 * the head switches them on — everyone always sees their own figures, and the part that
 * turns a household into a league table is opt-in.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    await assertMember(user.id, id);

    const family = await prisma.family.findUniqueOrThrow({
      where: { id },
      select: {
        showRanking: true,
        showStreaks: true,
        allowNudges: true,
        monthlyReportToHead: true,
      },
    });

    const now = new Date();
    const back = Number(req.nextUrl.searchParams.get("back") ?? 0);
    const offset = Number.isFinite(back) && back > 0 && back < 12 ? -Math.floor(back) : 0;
    const start =
      offset === 0 ? zonedMonthStart(now, user.timezone) : zonedMonthStartOffset(now, user.timezone, offset);
    const end =
      offset === 0
        ? now
        : zonedMonthStartOffset(now, user.timezone, offset + 1);
    // "Come due" is capped at now for the current month, and at the month's end for a
    // past one.
    const dueBy = end < now ? end : now;

    // Shared with the monthly email in lib/scoreboard.ts. Two implementations of these
    // definitions would eventually produce a report that contradicts the screen, and
    // nobody could tell which to believe.
    const rows = orderMembers(
      await memberStats(id, start, end, dueBy),
      family.showRanking,
    );

    const ordered = rows.map((r) => ({
      userId: r.userId,
      name: r.name,
      role: r.role,
      self: r.userId === user.id,
      assigned: r.assigned,
      completed: r.completed,
      onTime: r.onTime,
      outstanding: r.outstanding,
      // Streak fields are omitted rather than zeroed when the family hasn't switched them
      // on, so a client can't render a badge it was never meant to see.
      ...(family.showStreaks
        ? {
            streakWeeks: r.streakWeeks,
            bestStreakWeeks: r.bestStreakWeeks,
            streakMonths: r.streakMonths,
            bestStreakMonths: r.bestStreakMonths,
          }
        : {}),
    }));

    return {
      month: start,
      ranked: family.showRanking,
      streaks: family.showStreaks,
      nudges: family.allowNudges,
      monthlyReport: family.monthlyReportToHead,
      members: ordered,
    };
  });
}
