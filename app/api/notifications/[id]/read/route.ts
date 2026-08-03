import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    // updateMany with the owner in the filter: someone else's id simply matches
    // nothing and reports 0 updated, rather than needing a separate lookup.
    const result = await prisma.notification.updateMany({
      where: { id, userId: user.id },
      data: { read: true },
    });
    return { updated: result.count };
  });
}
