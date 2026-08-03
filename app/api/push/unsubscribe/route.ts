import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return json(async (user) => {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.endpoint !== "string") return { removed: 0 };
    // Scoped to the caller: you can drop your own device, not somebody else's.
    const result = await prisma.pushSubscription.deleteMany({
      where: { endpoint: body.endpoint, userId: user.id },
    });
    return { removed: result.count };
  });
}
