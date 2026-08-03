import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json, HttpError } from "@/lib/http";
import { DEFAULT_CATEGORIES, uniqueJoinCode } from "@/lib/families";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every family the caller belongs to, with members. The join code and pending
 * requests are only included where they are the head — a plain member has no
 * business handing the code out or seeing who has applied.
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
            joinRequests: {
              where: { status: "pending" },
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
      members: family.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        joinedAt: m.joinedAt,
        self: m.user.id === user.id,
      })),
      pendingRequests:
        role === "head"
          ? family.joinRequests.map((r) => ({
              id: r.id,
              userId: r.user.id,
              name: r.user.name,
              email: r.user.email,
              createdAt: r.createdAt,
            }))
          : [],
    }));
  });
}

/** Creates a family; the caller becomes its head. */
export async function POST(req: NextRequest) {
  return json(async (user) => {
    const body = await req.json().catch(() => ({}));
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
