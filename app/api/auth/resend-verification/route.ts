import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendVerificationEmail } from "@/lib/verify-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Requests within this window are ignored, so the endpoint can't be used to spam. */
const RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * PUBLIC — send the verification link again.
 *
 * Always answers 200 with the same message, whatever the address turns out to be.
 * An unauthenticated caller must not be able to tell a registered address from an
 * unregistered one, an activated account from a waiting one, or a rate-limited
 * request from a delivered one — each of those differences is an enumeration oracle,
 * and this endpoint takes a bare email address from anybody.
 *
 * The cooldown is why the "already sent" case has to look identical too: without it,
 * a fast second request returning something different would report whether the first
 * one found an account.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  const same = NextResponse.json({
    message:
      "If that address needs confirming, a new link is on its way. Check your inbox and spam folder.",
  });

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return same;

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      emailVerifiedAt: true,
      verifyTokenSentAt: true,
    },
  });

  // Nothing to do for an address that isn't waiting on a link. Rejected accounts are
  // excluded on purpose: a link must not be able to undo a moderation decision, and
  // verifyEmailToken won't reactivate one either.
  if (!user || user.status !== "pending" || user.emailVerifiedAt) return same;

  const lastSent = user.verifyTokenSentAt?.getTime() ?? 0;
  if (Date.now() - lastSent < RESEND_COOLDOWN_MS) return same;

  await sendVerificationEmail(user);
  return same;
}
