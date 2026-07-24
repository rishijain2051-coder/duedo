import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return json(() => {
    const userId = req.nextUrl.searchParams.get("userId") || undefined;
    return prisma.notification.findMany({
      where: userId ? { userId } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { name: true } } },
    });
  });
}
