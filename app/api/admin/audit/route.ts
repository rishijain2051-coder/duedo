import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { jsonAdmin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The audit trail, newest first. Filterable by action prefix and actor. */
export async function GET(req: NextRequest) {
  return jsonAdmin(async () => {
    const p = req.nextUrl.searchParams;
    const action = p.get("action");
    const actorId = p.get("actorId");
    const take = Math.min(Number(p.get("take") ?? 100) || 100, 500);

    const rows = await prisma.activityLog.findMany({
      where: {
        ...(action ? { action: { startsWith: action } } : {}),
        ...(actorId ? { actorId } : {}),
      },
      orderBy: { timestamp: "desc" },
      take,
      include: { actor: { select: { id: true, name: true } } },
    });

    return rows.map((r) => ({
      id: r.id,
      actor: r.actor ? { id: r.actor.id, name: r.actor.name } : null,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      detail: r.detail,
      timestamp: r.timestamp,
    }));
  });
}
