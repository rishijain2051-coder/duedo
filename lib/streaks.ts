import { prisma } from "./db";
import { zonedMonthStart, zonedMonthStartOffset, zonedWeekBounds } from "./time";

// Streak counters, advanced once per closed period.
//
// Deliberately not computed on read. A query would have to walk back over completions,
// and history is pruned after three months — so a computed weekly streak could never
// exceed about thirteen, and the "12 weeks straight" the whole idea rests on would be
// unreachable. Two integers per member instead, moved forward when a period closes, which
// survives the prune and reaches any length.
//
// The rule that shapes everything below: **a period with nothing assigned continues a
// streak.** Punishing someone for a quiet week is both wrong and the fastest way to make
// people stop looking at the number.

/** Runs on one tick in 360, like the rollup. Same reasoning — see lib/rollup.ts. */
const TICK_INTERVAL = 360;

export interface StreakResult {
  ran: boolean;
  members: number;
  weeksAdvanced: number;
  weeksBroken: number;
  monthsAdvanced: number;
  monthsBroken: number;
}

/**
 * Did this person miss anything that came due in the window?
 *
 * Two ways to miss, and both are needed: a completion recorded after its own cycle date,
 * and a cycle that came due and has no completion at all. Counting only the first would
 * make ignoring a reminder entirely look better than paying it a day late.
 */
async function missedAnything(
  familyId: string,
  userId: string,
  start: Date,
  end: Date,
): Promise<{ missed: boolean; assigned: number }> {
  const [history, outstanding] = await Promise.all([
    prisma.reminderHistory.findMany({
      where: {
        reminder: { familyId, assignedToId: userId },
        cycleDueAt: { gte: start, lt: end },
      },
      select: { completedOn: true, cycleDueAt: true },
    }),
    prisma.reminder.count({
      where: {
        familyId,
        assignedToId: userId,
        audience: "assignee",
        status: "active",
        dueAt: { gte: start, lt: end },
      },
    }),
  ]);

  const late = history.filter((h) => h.cycleDueAt && h.completedOn > h.cycleDueAt).length;
  return {
    missed: late > 0 || outstanding > 0,
    assigned: history.length + outstanding,
  };
}

/**
 * Advances or resets every member's counters for any period that has just closed.
 *
 * One watermark covers both cadences. On each run, a period is evaluated only if
 * `streakCheckedAt` predates its boundary, and the watermark is then set to now — so the
 * week and the month can both fire on the same run (they will, at the start of a month)
 * and neither can fire twice.
 *
 * If the app misses several weeks, only the most recent closed week is evaluated and the
 * gap is skipped rather than counted as failures. A lenient failure mode is the right one
 * for a number whose only job is encouragement.
 */
export async function advanceStreaks(
  now = new Date(),
  force = false,
): Promise<StreakResult> {
  const idle: StreakResult = {
    ran: false,
    members: 0,
    weeksAdvanced: 0,
    weeksBroken: 0,
    monthsAdvanced: 0,
    monthsBroken: 0,
  };
  if (!force && Math.floor(now.getTime() / 60_000) % TICK_INTERVAL !== 0) return idle;

  const members = await prisma.familyMember.findMany({
    select: {
      id: true,
      familyId: true,
      userId: true,
      streakWeeks: true,
      bestStreakWeeks: true,
      streakMonths: true,
      bestStreakMonths: true,
      streakCheckedAt: true,
      user: { select: { timezone: true } },
    },
  });

  const result: StreakResult = { ...idle, ran: true, members: members.length };

  for (const m of members) {
    try {
      const tz = m.user.timezone;
      const { start: weekStart } = zonedWeekBounds(now, tz);
      const monthStart = zonedMonthStart(now, tz);
      const checked = m.streakCheckedAt;

      const data: Record<string, number | Date> = {};

      if (!checked || checked < weekStart) {
        // The week that just ended, in this member's own zone.
        const prevWeek = zonedWeekBounds(new Date(weekStart.getTime() - 1), tz);
        const { missed, assigned } = await missedAnything(
          m.familyId,
          m.userId,
          prevWeek.start,
          weekStart,
        );
        if (missed) {
          data.streakWeeks = 0;
          result.weeksBroken++;
        } else if (assigned > 0) {
          const next = m.streakWeeks + 1;
          data.streakWeeks = next;
          data.bestStreakWeeks = Math.max(m.bestStreakWeeks, next);
          result.weeksAdvanced++;
        }
        // assigned === 0 and nothing missed: the streak is left exactly as it was.
      }

      if (!checked || checked < monthStart) {
        const prevMonthStart = zonedMonthStartOffset(now, tz, -1);
        const { missed, assigned } = await missedAnything(
          m.familyId,
          m.userId,
          prevMonthStart,
          monthStart,
        );
        if (missed) {
          data.streakMonths = 0;
          result.monthsBroken++;
        } else if (assigned > 0) {
          const next = m.streakMonths + 1;
          data.streakMonths = next;
          data.bestStreakMonths = Math.max(m.bestStreakMonths, next);
          result.monthsAdvanced++;
        }
      }

      // The watermark moves whenever either period was considered, even if neither
      // counter changed — otherwise a quiet week would be re-evaluated every run.
      if (!checked || checked < weekStart || checked < monthStart) {
        data.streakCheckedAt = now;
        await prisma.familyMember.update({ where: { id: m.id }, data });
      }
    } catch (e) {
      console.error(`[streaks] member ${m.id} failed:`, (e as Error).message);
    }
  }

  return result;
}
