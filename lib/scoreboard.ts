import { prisma } from "./db";

// Who kept up with what they were given.
//
// Extracted so the scoreboard route and the monthly email cannot disagree. They are the
// same claim delivered two ways, and the failure mode of two implementations is an email
// that contradicts the screen — which is worse than either being slightly wrong, because
// nobody can tell which to believe.
//
// The definitions are the substance here, so they are stated once:
//
//   ASSIGNED — cycles addressed to this person that have actually come due in the window.
//     Cycles due later are excluded: counting them makes everybody look behind on the 2nd
//     of the month, which is both wrong and demoralising.
//
//   COMPLETED — history rows for those cycles. Counted by *assignment*, so a member is
//     credited with their own workload; who physically pressed the button is in the
//     activity feed, which is the better place for it.
//
//   ON TIME — completedOn <= cycleDueAt. Only answerable because the cycle is stamped on
//     the history row; before that column existed a recurring reminder's due date had
//     already moved on by the time anyone could ask.

export interface MemberStats {
  userId: string;
  name: string;
  role: string;
  assigned: number;
  completed: number;
  onTime: number;
  outstanding: number;
  streakWeeks: number;
  bestStreakWeeks: number;
  streakMonths: number;
  bestStreakMonths: number;
}

/**
 * Per-member figures for one family over one window.
 *
 * `dueBy` is where "has come due" is cut — `now` for the current month, the month's end
 * for a past one. Passed in rather than derived so the caller decides, and so a report for
 * last month doesn't silently exclude its final days.
 */
export async function memberStats(
  familyId: string,
  start: Date,
  end: Date,
  dueBy: Date,
): Promise<MemberStats[]> {
  const members = await prisma.familyMember.findMany({
    where: { familyId },
    orderBy: { joinedAt: "asc" },
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

  return Promise.all(
    members.map(async (m) => {
      const [history, outstanding] = await Promise.all([
        prisma.reminderHistory.findMany({
          where: {
            reminder: { familyId, assignedToId: m.userId },
            cycleDueAt: { gte: start, lt: end },
          },
          select: { completedOn: true, cycleDueAt: true },
        }),
        prisma.reminder.count({
          where: {
            familyId,
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
        assigned: completed + outstanding,
        completed,
        onTime,
        outstanding,
        streakWeeks: m.streakWeeks,
        bestStreakWeeks: m.bestStreakWeeks,
        streakMonths: m.streakMonths,
        bestStreakMonths: m.bestStreakMonths,
      };
    }),
  );
}

/**
 * Ranked, or in joining order.
 *
 * Sorting by score while claiming not to rank would be the same feature with the label
 * filed off, so the family's setting decides and nothing else does.
 */
export function orderMembers(rows: MemberStats[], ranked: boolean): MemberStats[] {
  if (!ranked) return rows;
  return [...rows].sort((a, b) => b.onTime - a.onTime || b.completed - a.completed);
}
