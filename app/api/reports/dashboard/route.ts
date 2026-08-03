import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { zonedDayBounds, zonedMonthStart } from "@/lib/time";
import { visibleReminderWhere } from "@/lib/ownership";
import { countOutstandingFor } from "@/lib/recipients";
import { familyIdsFor } from "@/lib/families";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The counters only. Kept alongside /reports/overview because the badge sync and
 * the service worker need `outstanding` without paying for the lists.
 */
export async function GET() {
  return json(async (user) => {
    const now = new Date();
    const { start: startOfToday, end: endOfToday } = zonedDayBounds(
      now,
      user.timezone,
    );
    const startOfMonth = zonedMonthStart(now, user.timezone);

    const visible = await visibleReminderWhere(user.id);
    const familyIds = await familyIdsFor(user.id);

    const [
      totalActive,
      dueToday,
      overdue,
      outstanding,
      completedThisMonth,
      monthlySpend,
    ] = await Promise.all([
      prisma.reminder.count({ where: { ...visible, status: "active" } }),
      prisma.reminder.count({
        where: {
          ...visible,
          status: "active",
          dueAt: { gte: startOfToday, lte: endOfToday },
        },
      }),
      prisma.reminder.count({
        where: { ...visible, status: "active", dueAt: { lt: startOfToday } },
      }),
      countOutstandingFor(user.id, familyIds, now),
      prisma.reminderHistory.count({
        where: {
          status: "completed",
          completedOn: { gte: startOfMonth },
          reminder: visible,
        },
      }),
      prisma.reminderHistory.aggregate({
        _sum: { amount: true },
        where: {
          status: "completed",
          completedOn: { gte: startOfMonth },
          reminder: visible,
        },
      }),
    ]);

    return {
      totalActive,
      dueToday,
      overdue,
      outstanding,
      completedThisMonth,
      monthlySpend: monthlySpend._sum.amount ?? 0,
    };
  });
}
