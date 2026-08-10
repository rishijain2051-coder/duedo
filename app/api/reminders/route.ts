import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { clientId, HttpError, json, readJson } from "@/lib/http";
import { sanitizeReminderInput } from "@/lib/reminder-logic";
import { visibleReminderWhere } from "@/lib/ownership";
import { assertReminderDestination, assertReminderFields } from "@/lib/reminder-scope";
import { assertReminderRoom } from "@/lib/plan-guard";
import { REMINDER_INCLUDE } from "@/lib/reminder-shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


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
      include: REMINDER_INCLUDE,
      orderBy: { dueAt: "asc" },
    });
  });
}

export async function POST(req: NextRequest) {
  return json(async (user) => {
    // A body that isn't JSON is the client's mistake, not a server fault.
    const body = await readJson(req);
    const data = sanitizeReminderInput(body, true, user.timezone);
    assertReminderFields(data, true);
    // An id minted by the client, so a reminder created offline can be replayed
    // safely: the second attempt finds its own row and returns it instead of making a
    // near-duplicate nobody asked for. Sending one is optional and no client has to.
    //
    // It is not an ownership claim — userId below is still always the caller, so an id
    // pointing at somebody else's reminder cannot reach the update path; it collides
    // and 409s, which is the honest answer to "create this, with this id".
    //
    // Checked here with the other field validation rather than after the destination
    // lookup below, so a malformed id reads as the client bug it is instead of taking
    // whatever status the scope check happens to return first.
    const id = clientId(body.id);
    await assertReminderDestination(data, user.id, null, true);

    if (id) {
      const mine = await prisma.reminder.findFirst({
        where: { id, userId: user.id },
        include: REMINDER_INCLUDE,
      });
      // Already landed — a lost response, or a queue replayed twice. The reminder the
      // caller asked for exists and is theirs, which is what they wanted to hear.
      if (mine) return mine;
    }

    // After the replay check on purpose: a queued create arriving twice must return
    // the row it already made, not be refused for a slot it is already occupying.
    await assertReminderRoom(user);

    try {
      return await prisma.reminder.create({
        // userId is always the caller: ownership is never taken from the body.
        data: { ...data, ...(id ? { id } : {}), userId: user.id } as never,
        include: REMINDER_INCLUDE,
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        throw new HttpError(409, "A reminder with that id already exists.");
      }
      throw e;
    }
  }, 201);
}
