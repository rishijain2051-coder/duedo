import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return json(async () => {
    const assignedToId = req.nextUrl.searchParams.get("assignedToId") || undefined;
    const where = assignedToId ? { assignedToId } : {};
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
    const endOfToday = new Date(new Date().setHours(23, 59, 59, 999));
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [totalActive, dueToday, overdue, completedThisMonth, monthlySpend] =
      await Promise.all([
        prisma.reminder.count({ where: { ...where, status: "active" } }),
        prisma.reminder.count({
          where: { ...where, status: "active", dueDate: { gte: startOfToday, lt: endOfToday } },
        }),
        prisma.reminder.count({
          where: { ...where, status: "active", dueDate: { lt: startOfToday } },
        }),
        prisma.reminderHistory.count({
          where: { reminder: where, status: "completed", completedOn: { gte: startOfMonth } },
        }),
        prisma.reminderHistory.aggregate({
          _sum: { amount: true },
          where: { reminder: where, status: "completed", completedOn: { gte: startOfMonth } },
        }),
      ]);

    return {
      totalActive,
      dueToday,
      overdue,
      completedThisMonth,
      monthlySpend: monthlySpend._sum.amount ?? 0,
    };
  });
}
