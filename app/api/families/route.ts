import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json, HttpError, readJson } from "@/lib/http";
import { DEFAULT_CATEGORIES, uniqueJoinCode } from "@/lib/families";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every family the caller belongs to, with members. The join code is only included
 * where they are the head — a plain member has no business handing it out, and
 * since the code alone now admits someone, that matters more than it used to.
 */
export async function GET() {
  return json(async (user) => {
    const memberships = await prisma.familyMember.findMany({
      where: { userId: user.id },
      orderBy: { joinedAt: "asc" },
      include: {
        family: {
          include: {
            members: {
              orderBy: { joinedAt: "asc" },
              include: { user: { select: { id: true, name: true, email: true } } },
            },
          },
        },
      },
    });

    return memberships.map(({ role, family }) => ({
      id: family.id,
      name: family.name,
      role,
      createdAt: family.createdAt,
      joinCode: role === "head" ? family.joinCode : null,
      /**
       * What the family has opted into.
       *
       * Carried on every load rather than fetched with the scoreboard, because the
       * reminders page needs `allowNudges` and has no scoreboard — and because the
       * scoreboard never returned `monthlyReportToHead` at all, so the head's switch for
       * it showed as on however it was actually set. Four booleans is a cheaper payload
       * than a second request, and one source of truth beats two.
       */
      flags: {
        showRanking: family.showRanking,
        showStreaks: family.showStreaks,
        allowNudges: family.allowNudges,
        monthlyReportToHead: family.monthlyReportToHead,
      },
      members: family.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        joinedAt: m.joinedAt,
        self: m.user.id === user.id,
      })),
    }));
  });
}

/** Creates a family; the caller becomes its head. */
export async function POST(req: NextRequest) {
  return json(async (user) => {
    const body = await readJson(req);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (name.length < 2) throw new HttpError(400, "Give the family a name.");

    const joinCode = await uniqueJoinCode();

    const family = await prisma.family.create({
      data: {
        name,
        joinCode,
        members: { create: { userId: user.id, role: "head" } },
        // A family starts with its own category list, separate from anyone's
        // personal one.
        categories: { create: DEFAULT_CATEGORIES },
      },
    });

    // Creating a family is the act that makes someone a family account; without
    // this the UI would keep hiding every family surface from them.
    if (user.accountType !== "family") {
      await prisma.user.update({
        where: { id: user.id },
        data: { accountType: "family" },
      });
    }

    await audit({
      actorId: user.id,
      action: "family.create",
      entity: "family",
      entityId: family.id,
      detail: { name },
    });

    return { id: family.id, name: family.name, joinCode: family.joinCode, role: "head" };
  }, 201);
}
