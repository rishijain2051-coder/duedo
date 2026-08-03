import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json, HttpError } from "@/lib/http";
import { normalizeJoinCode } from "@/lib/families";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Submits a join code. Knowing the code gets you into the queue, not the family —
 * the head still has to approve, so a leaked code can't quietly add strangers to a
 * shared reminder list.
 */
export async function POST(req: NextRequest) {
  return json(async (user) => {
    const body = await req.json().catch(() => ({}));
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

    const existing = await prisma.familyJoinRequest.findUnique({
      where: { familyId_userId: { familyId: family.id, userId: user.id } },
    });

    if (existing?.status === "pending") {
      return { status: "pending", family: family.name, message: "Already waiting for approval." };
    }

    // A previous rejection shouldn't block a fresh attempt forever — the head
    // simply sees the request again.
    await prisma.familyJoinRequest.upsert({
      where: { familyId_userId: { familyId: family.id, userId: user.id } },
      create: { familyId: family.id, userId: user.id },
      update: { status: "pending", createdAt: new Date(), decidedAt: null },
    });

    if (user.accountType !== "family") {
      await prisma.user.update({
        where: { id: user.id },
        data: { accountType: "family" },
      });
    }

    await audit({
      actorId: user.id,
      action: "family.join.request",
      entity: "family",
      entityId: family.id,
    });

    return {
      status: "pending",
      family: family.name,
      message: `Request sent to ${family.name}. The family head has to approve it.`,
    };
  }, 201);
}
