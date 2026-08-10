import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json, HttpError, readJson } from "@/lib/http";
import { normalizeJoinCode } from "@/lib/families";
import { audit } from "@/lib/audit";
import { assertFamilySeat } from "@/lib/plan-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Joins a family by its code. The code *is* the permission — entering a valid one
 * makes you a member there and then.
 *
 * There used to be a head-approval step in between. It was dropped deliberately:
 * the code only ever comes from the head, so approving asked them to confirm a
 * decision they had already made by sharing it, and in the meantime the person who
 * entered it saw nothing and had no way to tell whether it had worked.
 *
 * The trade is real: a leaked code now admits whoever has it rather than queueing
 * them. The head's controls are rotating the code, which invalidates the old one,
 * and removing a member — so the recovery is quick, and nothing on the shared list
 * stays visible to someone who has been removed.
 */
export async function POST(req: NextRequest) {
  return json(async (user) => {
    const body = await readJson(req);
    const joinCode = normalizeJoinCode(body?.joinCode);
    if (joinCode.length < 4) throw new HttpError(400, "Enter the family's join code.");

    const family = await prisma.family.findUnique({
      where: { joinCode },
      select: { id: true, name: true },
    });
    // Deliberately vague: this endpoint is a code oracle otherwise, and someone
    // could enumerate valid codes by watching for a different message.
    if (!family) throw new HttpError(404, "No family found for that code.");

    const already = await prisma.familyMember.findUnique({
      where: { familyId_userId: { familyId: family.id, userId: user.id } },
      select: { id: true },
    });
    if (already) throw new HttpError(409, `You're already in ${family.name}.`);

    // Charged to the head's plan, not the joiner's — one payment, four people. Checked
    // after the "already a member" case above so rejoining is never mistaken for a
    // fifth seat.
    await assertFamilySeat(family.id);

    await prisma.familyMember.create({
      data: { familyId: family.id, userId: user.id, role: "member" },
    });

    // Being in a family is what makes someone a family account; without this the
    // UI would keep hiding every family surface from them.
    if (user.accountType !== "family") {
      await prisma.user.update({
        where: { id: user.id },
        data: { accountType: "family" },
      });
    }

    await audit({
      actorId: user.id,
      action: "family.join",
      entity: "family",
      entityId: family.id,
      detail: { name: family.name },
    });

    return {
      status: "joined",
      family: family.name,
      familyId: family.id,
      message: `You're in ${family.name}.`,
    };
  }, 201);
}
