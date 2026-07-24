import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPin, verifyPin, isValidPin } from "@/lib/pin";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { memberId, pin } = await req.json();
    if (!memberId || !isValidPin(pin)) {
      return NextResponse.json(
        { message: "Enter a 4–6 digit PIN." },
        { status: 400 },
      );
    }

    const member = await prisma.user.findUnique({ where: { id: memberId } });
    if (!member) {
      return NextResponse.json({ message: "Member not found." }, { status: 404 });
    }

    if (!member.password_hash) {
      // First login for this member sets their PIN.
      const hash = await hashPin(pin);
      await prisma.user.update({
        where: { id: member.id },
        data: { password_hash: hash },
      });
    } else {
      const ok = await verifyPin(pin, member.password_hash);
      if (!ok) {
        return NextResponse.json({ message: "Incorrect PIN." }, { status: 401 });
      }
    }

    const token = await createSessionToken({
      memberId: member.id,
      name: member.name,
    });
    const res = NextResponse.json({
      id: member.id,
      name: member.name,
      email: member.email,
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  } catch (e) {
    return NextResponse.json(
      { message: (e as Error).message || "Login failed" },
      { status: 500 },
    );
  }
}
