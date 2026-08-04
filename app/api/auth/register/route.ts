import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPin, isValidPin, PIN_LENGTH } from "@/lib/pin";
import { createSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { sendVerificationEmail } from "@/lib/verify-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC — self-registration.
 *
 * The account lands `pending` and is activated by clicking the link in the
 * verification email. No admin is involved: approval asked one to judge a name and
 * an address they had never seen, which was not a real check, while the person who
 * signed up waited on someone they had no way to contact.
 *
 * Two accounts are still activated without a link, and both are deliberate:
 *
 *   * the first account on an empty install, because a misconfigured SMTP setup
 *     would otherwise leave the install with no way in at all — that grant is a real
 *     if brief window, which is why DEPLOY.md says to register immediately after the
 *     first deploy
 *   * any signup when mail is not configured, since there would be no link to send;
 *     these fall back to admin approval, and the response says so
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
        // The install owner's address is not verified by a link — nobody could have
        // sent them one yet — so it is left unverified rather than claimed.
        emailVerifiedAt: null,
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
      const { sent, reason } = await sendVerificationEmail(user);
      return NextResponse.json({
        status: "pending",
        verificationSent: sent,
        message: sent
          ? `Account created. Check ${email} for a link to confirm the address — that's what activates it.`
          : // No link means no self-service route in, so say what actually happens
            // next rather than leaving them waiting for an email that isn't coming.
            `Account created, but the confirmation email could not be sent (${reason}). An admin will need to activate it.`,
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
