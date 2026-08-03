import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { visibleReminderWhere } from "@/lib/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return json(async (user) => {
    const history = await prisma.reminderHistory.findMany({
      where: { reminder: await visibleReminderWhere(user.id) },
      orderBy: { completedOn: "desc" },
      take: 8,
      include: {
        reminder: { select: { title: true, familyId: true } },
        // On a shared list, who dealt with it is half the information.
        completedBy: { select: { name: true } },
      },
    });
    return history.map((h) => ({
      id: h.id,
      title: h.reminder?.title ?? "Reminder",
      by: h.reminder?.familyId ? (h.completedBy?.name ?? null) : null,
      amount: h.amount ?? 0,
      status: h.status,
      completedOn: h.completedOn,
      remarks: h.remarks,
    }));
  });
}
