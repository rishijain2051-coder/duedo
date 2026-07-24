import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPin, isValidPin } from "@/lib/pin";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public: the login screen shows this list so you can pick who you are.
export async function GET() {
  const members = await prisma.user.findMany({
    select: { id: true, name: true, password_hash: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(
    members.map((m) => ({ id: m.id, name: m.name, hasPin: !!m.password_hash })),
  );
}

// Public bootstrap: create the very first family member (admin) when none exist yet.
// Once at least one member exists, this is locked — use the authenticated /api/users.
export async function POST(req: NextRequest) {
  try {
    const count = await prisma.user.count();
    if (count > 0) {
      return NextResponse.json(
        { message: "Setup is already complete. Please log in." },
        { status: 403 },
      );
    }
    const { name, email, pin } = await req.json();
    if (!name || !email) {
      return NextResponse.json(
        { message: "Name and email are required." },
        { status: 400 },
      );
    }
    if (!isValidPin(pin)) {
      return NextResponse.json({ message: "PIN must be 4–6 digits." }, { status: 400 });
    }
    const member = await prisma.user.create({
      data: {
        name,
        email,
        role: "admin",
        password_hash: await hashPin(pin),
      },
      select: { id: true, name: true, email: true },
    });
    const token = await createSessionToken({ memberId: member.id, name: member.name });
    const res = NextResponse.json(member, { status: 201 });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  } catch (e) {
    return NextResponse.json(
      { message: (e as Error).message || "Setup failed" },
      { status: 500 },
    );
  }
}
