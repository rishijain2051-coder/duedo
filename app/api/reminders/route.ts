import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { sanitizeReminderInput } from "@/lib/reminder-logic";
import { visibleReminderWhere } from "@/lib/ownership";
import { assertReminderDestination } from "@/lib/reminder-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INCLUDE = {
  category: true,
  family: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
} as const;

/**
 * Everything the caller can see: their personal reminders plus the shared list of
 * every family they belong to.
 *
 * `?scope=mine` narrows to personal only, `?scope=<familyId>` to one family —
 * which is how the Mine/Family tabs are served without shipping the lot each time.
 */
export async function GET(req: NextRequest) {
  return json(async (user) => {
    const params = req.nextUrl.searchParams;
    const status = params.get("status") || undefined;
    const scope = params.get("scope");

    const visible = await visibleReminderWhere(user.id);
    const where =
      scope === "mine"
        ? { userId: user.id, familyId: null }
        : scope
          ? // Intersected with what's visible, so an arbitrary familyId in the
            // query string can't widen the result.
            { AND: [visible, { familyId: scope }] }
          : visible;

    return prisma.reminder.findMany({
      where: { ...where, ...(status ? { status } : {}) },
      include: INCLUDE,
      orderBy: { dueAt: "asc" },
    });
  });
}

export async function POST(req: NextRequest) {
  return json(async (user) => {
    const body = await req.json();
    const data = sanitizeReminderInput(body, true, user.timezone, user.defaultTime);
    await assertReminderDestination(data, user.id);

    return prisma.reminder.create({
      // userId is always the caller: ownership is never taken from the body.
      data: { ...data, userId: user.id } as never,
      include: INCLUDE,
    });
  }, 201);
}
