import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json, HttpError, readJson } from "@/lib/http";
import { DEFAULT_CATEGORIES, uniqueJoinCode } from "@/lib/families";
import { audit } from "@/lib/audit";
import { assertFamilyRoom } from "@/lib/plan-guard";
import { FAMILY_MEMBERSHIP_INCLUDE, shapeFamilies } from "@/lib/family-shape";

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
      include: FAMILY_MEMBERSHIP_INCLUDE,
    });
    return shapeFamilies(memberships, user.id);
  });
}

/** Creates a family; the caller becomes its head. */
export async function POST(req: NextRequest) {
  return json(async (user) => {
    const body = await readJson(req);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (name.length < 2) throw new HttpError(400, "Give the family a name.");

    // Creating a household is the Family plan. Joining one stays free on every plan —
    // the point of the tier is that one person pays and the household joins, so the
    // seat check on the way in bills the head instead (see assertFamilySeat).
    await assertFamilyRoom(user);

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
