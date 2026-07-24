import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }
  const member = await prisma.user.findUnique({
    where: { id: session.memberId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      emailOptIn: true,
      notifyDaysBefore: true,
      createdAt: true,
    },
  });
  if (!member) {
    return NextResponse.json({ message: "Member not found" }, { status: 401 });
  }
  return NextResponse.json(member);
}
