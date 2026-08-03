import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPin, isValidPin } from "@/lib/pin";
import { createSession } from "@/lib/auth";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC — email + PIN sign-in.
 *
 * Identifying by email rather than by picking a name from a list is deliberate:
 * reminders are private here, so the set of people with accounts shouldn't be
 * readable by anyone who loads the login page.
 *
 * For the same reason a wrong email and a wrong PIN return the same message —
 * there's nothing to learn from the difference. A `pending` account is the one
 * case that says something specific, because otherwise someone waiting on
 * approval has no way to tell that from having mistyped their PIN.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const pin = body?.pin;

    if (!email || !isValidPin(pin)) {
      return NextResponse.json(
        { message: "Enter your email and a 4–6 digit PIN." },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const ok =
      user?.password_hash && (await verifyPin(pin, user.password_hash));

    if (!user || !ok) {
      return NextResponse.json(
        { message: "Incorrect email or PIN." },
        { status: 401 },
      );
    }

    if (user.status === "pending") {
      return NextResponse.json(
        { message: "This account is still waiting for an admin to approve it." },
        { status: 403 },
      );
    }
    if (user.status !== "active") {
      return NextResponse.json(
        { message: "This account has been disabled." },
        { status: 403 },
      );
    }

    const { token } = await createSession(user.id, req.headers.get("user-agent"));
    const res = NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      accountType: user.accountType,
    });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return res;
  } catch (e) {
    return NextResponse.json(
      { message: (e as Error).message || "Login failed" },
      { status: 500 },
    );
  }
}
