import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { zonedDayBounds, zonedMonthStart } from "@/lib/time";
import { visibleReminderWhere } from "@/lib/ownership";
import { countOutstandingFor } from "@/lib/recipients";
import { familyIdsFor } from "@/lib/families";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the dashboard needs, in one round trip.
 *
 * Counts cover everything the caller can *see* — their own reminders plus their
 * families' shared lists. `outstanding` is narrower on purpose: it counts only
 * what is addressed to them, because that is what the app badge means.
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
      upcoming,
      history,
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
      prisma.reminder.findMany({
        where: { ...visible, status: "active" },
        include: {
          category: true,
          family: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true } },
        },
        orderBy: { dueAt: "asc" },
        take: 5,
      }),
      prisma.reminderHistory.findMany({
        where: { reminder: visible },
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
