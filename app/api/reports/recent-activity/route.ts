import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return json(async () => {
    const assignedToId = req.nextUrl.searchParams.get("assignedToId") || undefined;
    const where = assignedToId ? { reminder: { assignedToId } } : {};
    const history = await prisma.reminderHistory.findMany({
      where,
      orderBy: { completedOn: "desc" },
      take: 8,
      include: {
        reminder: { select: { title: true, assignedTo: { select: { name: true } } } },
      },
    });
    return history.map((h) => ({
      id: h.id,
      title: h.reminder?.title ?? "Reminder",
      member: h.reminder?.assignedTo?.name ?? null,
      amount: h.amount ?? 0,
      status: h.status,
      completedOn: h.completedOn,
      remarks: h.remarks,
    }));
  });
}
