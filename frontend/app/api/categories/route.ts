import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  return json(async () => {
    const count = await prisma.category.count();
    if (count === 0) {
      await prisma.category.createMany({ data: DEFAULT_CATEGORIES });
    }
    return prisma.category.findMany({ orderBy: { name: "asc" } });
  });
}

export async function POST(req: NextRequest) {
  return json(async () => {
    const body = await req.json();
    if (!body?.name) throw new HttpError(400, "Name is required");
    return prisma.category.create({
      data: { name: body.name, icon: body.icon ?? null, color: body.color ?? null },
    });
  }, 201);
}
