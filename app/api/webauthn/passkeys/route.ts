import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return json((user) =>
    prisma.passkey.findMany({
      where: { userId: user.id },
      select: { id: true, label: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: "asc" },
    }),
  );
}

export async function DELETE(req: NextRequest) {
  return json(async (user) => {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) throw new HttpError(400, "Pass the passkey id to remove.");
    const result = await prisma.passkey.deleteMany({
      where: { id, userId: user.id },
    });
    return { removed: result.count };
  });
}
