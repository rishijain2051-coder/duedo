import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { assignedToSelect, sanitizeReminderInput } from "@/lib/reminder-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return json(() => {
    const assignedToId = req.nextUrl.searchParams.get("assignedToId") || undefined;
    return prisma.reminder.findMany({
      where: assignedToId ? { assignedToId } : {},
      include: { category: true, assignedTo: { select: assignedToSelect } },
      orderBy: { dueDate: "asc" },
    });
  });
}

export async function POST(req: NextRequest) {
  return json(async () => {
    const body = await req.json();
    return prisma.reminder.create({
      data: sanitizeReminderInput(body, true) as never,
      include: { category: true, assignedTo: { select: assignedToSelect } },
    });
  }, 201);
}
