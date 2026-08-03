import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json, HttpError } from "@/lib/http";
import { assertHead } from "@/lib/families";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pending join requests for this family. Head only. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    await assertHead(user.id, id);
    const rows = await prisma.familyJoinRequest.findMany({
      where: { familyId: id, status: "pending" },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.user.id,
      name: r.user.name,
      email: r.user.email,
      createdAt: r.createdAt,
    }));
  });
}

/** Approves or rejects one request. Head only. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    await assertHead(user.id, id);

    const body = await req.json().catch(() => ({}));
    const requestId = String(body?.requestId ?? "");
    const approve = body?.approve === true;
    if (!requestId) throw new HttpError(400, "Which request?");

    const request = await prisma.familyJoinRequest.findFirst({
      where: { id: requestId, familyId: id, status: "pending" },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!request) throw new HttpError(404, "Request not found");

    if (!approve) {
      await prisma.familyJoinRequest.update({
        where: { id: requestId },
        data: { status: "rejected", decidedAt: new Date() },
      });
      await audit({
        actorId: user.id,
        action: "family.join.reject",
        entity: "family",
        entityId: id,
        detail: { userId: request.userId },
      });
      return { approved: false, name: request.user.name };
    }

    // Membership and decision land together, so an approved request can never
    // exist without the membership it authorised.
    await prisma.$transaction([
      prisma.familyMember.create({
        data: { familyId: id, userId: request.userId, role: "member" },
      }),
      prisma.familyJoinRequest.update({
        where: { id: requestId },
        data: { status: "approved", decidedAt: new Date() },
      }),
    ]);

    await audit({
      actorId: user.id,
      action: "family.join.approve",
      entity: "family",
      entityId: id,
      detail: { userId: request.userId },
    });

    return { approved: true, name: request.user.name };
  });
}
