import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  return json(async () => {
    const userId = req.nextUrl.searchParams.get("userId") || undefined;
    const result = await prisma.notification.updateMany({
      where: userId ? { userId, read: false } : { read: false },
      data: { read: true },
    });
    return { updated: result.count };
  });
}
