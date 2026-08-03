import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { sanitizeReminderInput } from "@/lib/reminder-logic";
import { assertOwnedCategory } from "@/lib/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return json((user) => {
    const status = req.nextUrl.searchParams.get("status") || undefined;
    return prisma.reminder.findMany({
      where: { userId: user.id, ...(status ? { status } : {}) },
      include: { category: true },
      orderBy: { dueAt: "asc" },
    });
  });
}

export async function POST(req: NextRequest) {
  return json(async (user) => {
    const body = await req.json();
    const data = sanitizeReminderInput(body, true, user.timezone, user.defaultTime);
    // Checked rather than trusted: without this a caller could attach their
    // reminder to somebody else's category and read the name back out of the
    // `include` below.
    await assertOwnedCategory(data.categoryId, user.id);

    return prisma.reminder.create({
      data: { ...data, userId: user.id } as never,
      include: { category: true },
    });
  }, 201);
}
