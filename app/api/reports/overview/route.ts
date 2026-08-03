import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { zonedDayBounds, zonedMonthStart } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the dashboard needs, in one round trip.
 *
 * The page used to make three requests and slice the upcoming list client-side,
 * which meant shipping every active reminder just to show five. The sort and the
 * slice happen here instead.
 */
export async function GET() {
  return json(async (user) => {
    const now = new Date();
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
      upcoming,
      history,
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
      prisma.reminder.findMany({
        where: { ...mine, status: "active" },
        include: { category: true },
        orderBy: { dueAt: "asc" },
        take: 5,
      }),
      prisma.reminderHistory.findMany({
        where: { reminder: mine },
        orderBy: { completedOn: "desc" },
        take: 8,
        include: { reminder: { select: { title: true } } },
      }),
    ]);

    return {
      stats: {
        totalActive,
        dueToday,
        overdue,
        outstanding,
        completedThisMonth,
        monthlySpend: monthlySpend._sum.amount ?? 0,
      },
      upcoming,
      activity: history.map((h) => ({
        id: h.id,
        title: h.reminder?.title ?? "Reminder",
        amount: h.amount ?? 0,
        status: h.status,
        completedOn: h.completedOn,
        remarks: h.remarks,
      })),
    };
  });
}
