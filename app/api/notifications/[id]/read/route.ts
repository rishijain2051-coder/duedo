import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async () => {
    const { id } = await ctx.params;
    const result = await prisma.notification.updateMany({
      where: { id },
      data: { read: true },
    });
    return { updated: result.count };
  });
}
