import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { hashPin, isValidPin } from "@/lib/pin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const publicSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  emailOptIn: true,
  notifyDaysBefore: true,
  createdAt: true,
};

export async function GET() {
  return json(() =>
    prisma.user.findMany({ select: publicSelect, orderBy: { createdAt: "asc" } }),
  );
}

export async function POST(req: NextRequest) {
  return json(async () => {
    const body = await req.json();
    if (!body?.name || !body?.email) {
      throw new HttpError(400, "Name and email are required");
    }
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw new HttpError(409, "A member with this email already exists");

    let password_hash: string | undefined;
    if (body.pin) {
      if (!isValidPin(body.pin)) throw new HttpError(400, "PIN must be 4–6 digits");
      password_hash = await hashPin(body.pin);
    }

    return prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        role: body.role ?? "member",
        emailOptIn: body.emailOptIn ?? true,
        notifyDaysBefore: body.notifyDaysBefore ?? 3,
        password_hash,
      },
      select: publicSelect,
    });
  }, 201);
}
