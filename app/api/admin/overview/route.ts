import { prisma } from "@/lib/db";
import { jsonAdmin } from "@/lib/http";
import { deliveryHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Counts for the admin landing page, plus enough health to show what's red. */
export async function GET() {
  return jsonAdmin(async () => {
    const now = new Date();
    const [
      total,
      pending,
      active,
      rejected,
      admins,
      families,
      reminders,
      activeReminders,
      overdue,
      devices,
      blocked,
      health,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: "pending" } }),
      prisma.user.count({ where: { status: "active" } }),
      prisma.user.count({ where: { status: "rejected" } }),
      prisma.user.count({ where: { role: "admin" } }),
      prisma.family.count(),
      prisma.reminder.count(),
      prisma.reminder.count({ where: { status: "active" } }),
      prisma.reminder.count({ where: { status: "active", dueAt: { lte: now } } }),
      prisma.pushSubscription.count(),
      prisma.pushSubscription.count({ where: { blockedAt: { not: null } } }),
      deliveryHealth(),
    ]);

    return {
      users: { total, pending, active, rejected, admins },
      families,
      reminders: { total: reminders, active: activeReminders, overdue },
      devices: { total: devices, blocked },
      health,
    };
  });
}
