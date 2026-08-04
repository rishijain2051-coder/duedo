import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { assertMember } from "@/lib/families";
import { zonedMonthStart, zonedMonthStartOffset } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who is keeping up with what they were given.
 *
 * The definitions matter more than the code, because these are the numbers a household
 * will argue about. Stated once, here, and nowhere else:
 *
 *   ASSIGNED — cycles addressed to this person that have actually come due this month.
 *     Reminders due later in the month are excluded on purpose: counting them makes
 *     everyone look behind on the 2nd, which is both wrong and demoralising.
 *
 *   COMPLETED — history rows for those cycles. Counted by *assignment*, not by who
 *     pressed the button, so a member is credited for their own workload; who actually
 *     did it is in the activity feed, which is the better place for it.
 *
 *   ON TIME — completedOn <= cycleDueAt. Only answerable because the cycle is stamped on
 *     the history row; before that column existed a recurring reminder's due date had
 *     already moved on by the time anyone could ask.
 *
 *   STREAK — held as counters on FamilyMember, advanced at each week and month close by
 *     lib/streaks.ts. Not computed here: detail is pruned after three months, so a
 *     computed streak could never exceed about thirteen weeks.
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
      select: { showRanking: true, showStreaks: true, allowNudges: true },
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

    const members = await prisma.familyMember.findMany({
      where: { familyId: id },
      select: {
        userId: true,
        role: true,
        streakWeeks: true,
        bestStreakWeeks: true,
        streakMonths: true,
        bestStreakMonths: true,
        user: { select: { name: true } },
      },
    });

    const rows = await Promise.all(
      members.map(async (m) => {
        const [history, outstanding] = await Promise.all([
          prisma.reminderHistory.findMany({
            where: {
              reminder: { familyId: id, assignedToId: m.userId },
              cycleDueAt: { gte: start, lt: end },
            },
            select: { completedOn: true, cycleDueAt: true },
          }),
          prisma.reminder.count({
            where: {
              familyId: id,
              assignedToId: m.userId,
              audience: "assignee",
              status: "active",
              dueAt: { gte: start, lt: dueBy },
            },
          }),
        ]);

        const completed = history.length;
        const onTime = history.filter(
          (h) => h.cycleDueAt && h.completedOn <= h.cycleDueAt,
        ).length;

        return {
          userId: m.userId,
          name: m.user.name,
          role: m.role,
          self: m.userId === user.id,
          assigned: completed + outstanding,
          completed,
          onTime,
          outstanding,
          ...(family.showStreaks
            ? {
                streakWeeks: m.streakWeeks,
                bestStreakWeeks: m.bestStreakWeeks,
                streakMonths: m.streakMonths,
                bestStreakMonths: m.bestStreakMonths,
              }
            : {}),
        };
      }),
    );

    // Ranked only when the family asked to be. Otherwise the order is joining order,
    // which carries no judgement — sorting by score while claiming not to rank would be
    // the same feature with the label filed off.
    const ordered = family.showRanking
      ? [...rows].sort((a, b) => b.onTime - a.onTime || b.completed - a.completed)
      : rows;

    return {
      month: start,
      ranked: family.showRanking,
      streaks: family.showStreaks,
      nudges: family.allowNudges,
      members: ordered,
    };
  });
}
