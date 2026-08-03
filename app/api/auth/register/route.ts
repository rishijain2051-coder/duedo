import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPin, isValidPin, PIN_LENGTH } from "@/lib/pin";
import { createSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC — self-registration.
 *
 * Anyone can create an account, but it lands as `pending` and cannot sign in
 * until an admin approves it. The one exception is a completely empty install:
 * the first account is auto-approved as an admin, because otherwise there would
 * be nobody with the authority to approve anybody.
 *
 * That first-account grant is a real (if brief) window — whoever reaches a fresh
 * deployment first becomes the admin — so DEPLOY.md tells you to register
 * immediately after the first deploy.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const pin = body?.pin;

    if (name.length < 2) {
      return NextResponse.json({ message: "Enter your name." }, { status: 400 });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json(
        { message: "Enter a valid email address." },
        { status: 400 },
      );
    }
    if (!isValidPin(pin)) {
      return NextResponse.json(
        { message: `PIN must be ${PIN_LENGTH} digits.` },
        { status: 400 },
      );
    }

    // solo hides every family surface; family unlocks creating or joining one.
    // Convertible later either way, so getting it wrong here costs nothing.
    const accountType = body?.accountType === "family" ? "family" : "solo";

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Deliberately explicit: this is a self-service signup form, so "that
      // address is taken" is information the person in front of it already has.
      return NextResponse.json(
        { message: "An account with this email already exists." },
        { status: 409 },
      );
    }

    const isFirstAccount = (await prisma.user.count()) === 0;

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password_hash: await hashPin(pin),
        role: isFirstAccount ? "admin" : "member",
        status: isFirstAccount ? "active" : "pending",
        accountType,
        approvedAt: isFirstAccount ? new Date() : null,
      },
    });

    await audit({
      actorId: user.id,
      action: "user.register",
      entity: "user",
      entityId: user.id,
      detail: { accountType, first: isFirstAccount },
    });

    if (!isFirstAccount) {
      return NextResponse.json({
        status: "pending",
        message:
          "Account created. An admin has to approve it before you can sign in.",
      });
    }

    // First account: sign them straight in.
    const { token } = await createSession(user.id, req.headers.get("user-agent"));
    const res = NextResponse.json({
      status: "active",
      message: "Welcome — your account is the admin for this install.",
    });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return res;
  } catch (e) {
    return NextResponse.json(
      { message: (e as Error).message || "Could not create the account." },
      { status: 500 },
    );
  }
}
