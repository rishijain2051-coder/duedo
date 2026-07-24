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

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async () => {
    const { id } = await ctx.params;
    const member = await prisma.user.findUnique({ where: { id }, select: publicSelect });
    if (!member) throw new HttpError(404, "Member not found");
    return member;
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async () => {
    const { id } = await ctx.params;
    const body = await req.json();
    const member = await prisma.user.findUnique({ where: { id } });
    if (!member) throw new HttpError(404, "Member not found");

    if (body.email && body.email !== member.email) {
      const clash = await prisma.user.findUnique({ where: { email: body.email } });
      if (clash) throw new HttpError(409, "That email is already in use");
    }

    let password_hash: string | undefined;
    if (body.pin) {
      if (!isValidPin(body.pin)) throw new HttpError(400, "PIN must be 4–6 digits");
      password_hash = await hashPin(body.pin);
    }

    return prisma.user.update({
      where: { id },
      data: {
        name: body.name ?? undefined,
        email: body.email ?? undefined,
        phone: body.phone ?? undefined,
        role: body.role ?? undefined,
        emailOptIn: body.emailOptIn ?? undefined,
        notifyDaysBefore: body.notifyDaysBefore ?? undefined,
        password_hash,
      },
      select: publicSelect,
    });
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async () => {
    const { id } = await ctx.params;
    const member = await prisma.user.findUnique({
      where: { id },
      include: { _count: { select: { reminders: true } } },
    });
    if (!member) throw new HttpError(404, "Member not found");
    if (member._count.reminders > 0) {
      throw new HttpError(
        409,
        "This member still has reminders assigned. Reassign or delete them first.",
      );
    }
    await prisma.notification.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } });
    return { deleted: true };
  });
}
