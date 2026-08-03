import { prisma } from "@/lib/db";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return json(async (user) => {
    const history = await prisma.reminderHistory.findMany({
      where: { reminder: { userId: user.id } },
      orderBy: { completedOn: "desc" },
      take: 8,
      include: { reminder: { select: { title: true } } },
    });
    return history.map((h) => ({
      id: h.id,
      title: h.reminder?.title ?? "Reminder",
      amount: h.amount ?? 0,
      status: h.status,
      completedOn: h.completedOn,
      remarks: h.remarks,
    }));
  });
}
