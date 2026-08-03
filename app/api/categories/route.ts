import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Seeded per account on first use, so a new user starts with something usable. */
const DEFAULT_CATEGORIES = [
  { name: "Insurance", icon: "ShieldCheck", color: "#3b82f6" },
  { name: "EMI / Loans", icon: "Landmark", color: "#8b5cf6" },
  { name: "Utility Bills", icon: "Zap", color: "#eab308" },
  { name: "Subscriptions", icon: "Repeat", color: "#ec4899" },
  { name: "Vehicle", icon: "Car", color: "#64748b" },
  { name: "Taxes", icon: "FileText", color: "#ef4444" },
  { name: "Health / Medicine", icon: "HeartPulse", color: "#10b981" },
  { name: "Birthdays", icon: "Cake", color: "#f97316" },
];

export async function GET() {
  return json(async (user) => {
    const count = await prisma.category.count({ where: { userId: user.id } });
    if (count === 0) {
      // skipDuplicates covers the race where two first-load requests seed at
      // once; the unique index on (userId, name) is what makes that safe.
      await prisma.category.createMany({
        data: DEFAULT_CATEGORIES.map((c) => ({ ...c, userId: user.id })),
        skipDuplicates: true,
      });
    }
    return prisma.category.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
    });
  });
}

export async function POST(req: NextRequest) {
  return json(async (user) => {
    const body = await req.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) throw new HttpError(400, "Name is required");

    const clash = await prisma.category.findFirst({
      where: { userId: user.id, name },
      select: { id: true },
    });
    if (clash) throw new HttpError(409, "You already have a category with that name.");

    return prisma.category.create({
      data: {
        userId: user.id,
        name,
        icon: body.icon ?? null,
        color: body.color ?? null,
      },
    });
  }, 201);
}
