import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPin, isValidPin, PIN_LENGTH } from "@/lib/pin";
import { audit } from "@/lib/audit";
import { sendVerificationEmail } from "@/lib/verify-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC — self-registration.
 *
 * Every account lands `pending` as a plain member and is activated by clicking the
 * link in the verification email. No admin is involved: approval asked one to judge a
 * name and an address they had never seen, which was not a real check, while the
 * person who signed up waited on someone they had no way to contact.
 *
 * There is no longer a "first account becomes the admin" case. It existed so a broken
 * SMTP setup couldn't strand a fresh install, but the price was that on any empty
 * database the first person to POST this route got admin — a capture window in
 * exchange for saving one SQL statement. A fresh install now promotes its own admin by
 * hand once (DEPLOY.md), and that account holds `isRootAdmin`, which no other admin
 * can take away.
 *
 * When mail is not configured there is no link to send, so those signups fall back to
 * an admin activating them by hand and the response says so.
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

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password_hash: await hashPin(pin),
        accountType,
      },
    });

    await audit({
      actorId: user.id,
      action: "user.register",
      entity: "user",
      entityId: user.id,
      detail: { accountType },
    });

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
  } catch (e) {
    return NextResponse.json(
      { message: (e as Error).message || "Could not create the account." },
      { status: 500 },
    );
  }
}
