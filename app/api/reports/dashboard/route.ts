import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { zonedDayBounds, zonedMonthStart } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return json(async (user) => {
    const now = new Date();
    // Day and month boundaries in this user's own zone — "due today" has to mean
    // today where they are, not today in UTC.
    const { start: startOfToday, end: endOfToday } = zonedDayBounds(
      now,
      user.timezone,
    );
    const startOfMonth = zonedMonthStart(now, user.timezone);

    const mine = { userId: user.id };

    const [
      totalActive,
      dueToday,
      overdue,
      outstanding,
      completedThisMonth,
      monthlySpend,
    ] = await Promise.all([
      prisma.reminder.count({ where: { ...mine, status: "active" } }),
      prisma.reminder.count({
        where: {
          ...mine,
          status: "active",
          dueAt: { gte: startOfToday, lte: endOfToday },
        },
      }),
      prisma.reminder.count({
        where: { ...mine, status: "active", dueAt: { lt: startOfToday } },
      }),
      prisma.reminder.count({
        where: { ...mine, status: "active", dueAt: { lte: now } },
      }),
      prisma.reminderHistory.count({
        where: {
          status: "completed",
          completedOn: { gte: startOfMonth },
          reminder: mine,
        },
      }),
      prisma.reminderHistory.aggregate({
        _sum: { amount: true },
        where: {
          status: "completed",
          completedOn: { gte: startOfMonth },
          reminder: mine,
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
