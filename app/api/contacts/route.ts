import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json, readJson } from "@/lib/http";
import { assertContactRoom } from "@/lib/plan-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Addresses outside the app that escalation may reach, and their consent state.
 *
 * Private to the account that added them. There is no sharing between family members:
 * "my accountant" is a relationship the person who has it should manage, and one member
 * adding an address on another's behalf is how you get a contact nobody remembers agreeing
 * to.
 */
export async function GET() {
  return json(async (user) => {
    const rows = await prisma.externalContact.findMany({
      where: { ownerId: user.id },
      orderBy: { email: "asc" },
      select: {
        id: true,
        email: true,
        label: true,
        confirmedAt: true,
        blockedAt: true,
        tokenSentAt: true,
      },
    });
    return rows.map((c) => ({
      id: c.id,
      email: c.email,
      label: c.label,
      // One word for the state, so the UI doesn't have to re-derive it from three dates.
      state: c.blockedAt
        ? ("blocked" as const)
        : c.confirmedAt
          ? ("confirmed" as const)
          : c.tokenSentAt
            ? ("invited" as const)
            : ("new" as const),
      confirmedAt: c.confirmedAt,
      invitedAt: c.tokenSentAt,
    }));
  });
}

export async function POST(req: NextRequest) {
  return json(async (user) => {
    const body = await readJson(req);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const label = typeof body.label === "string" ? body.label.trim().slice(0, 60) : null;

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpError(400, "Enter a valid email address.");
    }

    // Anyone's "never" is everyone's. The block is on the address, not on the pairing,
    // because "stop sending me this" answered once should not have to be answered again
    // for every user who happens to type it in.
    const blockedAnywhere = await prisma.externalContact.findFirst({
      where: { email, blockedAt: { not: null } },
      select: { id: true },
    });
    if (blockedAnywhere) {
      throw new HttpError(
        400,
        "That address has asked never to be contacted through this app.",
      );
    }

    // How many is a plan question now, not a constant here. Checked after the block
    // list above so someone who asked never to be contacted is refused for that reason
    // rather than being told about somebody else's billing.
    await assertContactRoom(user);

    const existing = await prisma.externalContact.findUnique({
      where: { ownerId_email: { ownerId: user.id, email } },
      select: { id: true },
    });
    if (existing) throw new HttpError(409, "You already have that address.");

    const created = await prisma.externalContact.create({
      data: { ownerId: user.id, email, label },
      select: { id: true, email: true, label: true },
    });

    // No invitation yet. It goes out when a reminder first tries to escalate to them,
    // so somebody who is added and never actually used is never written to at all.
    return { ...created, state: "new" as const };
  }, 201);
}

export async function DELETE(req: NextRequest) {
  return json(async (user) => {
    const body = await readJson(req);
    const id = typeof body.id === "string" ? body.id : "";
    const contact = await prisma.externalContact.findUnique({
      where: { id },
      select: { id: true, ownerId: true, blockedAt: true },
    });
    if (!contact || contact.ownerId !== user.id) throw new HttpError(404, "Not found");

    // A blocked address stays on record forever. Removing the row would let the same
    // address be added again, which would ask somebody who already said no a second
    // time — the one outcome the whole flow exists to prevent.
    if (contact.blockedAt) {
      throw new HttpError(
        400,
        "That address declined. The record stays so nobody can add it again.",
      );
    }

    await prisma.externalContact.delete({ where: { id } });
    return { deleted: true };
  });
}
