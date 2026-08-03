import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { prisma } from "@/lib/db";
import { rpInfo, takeChallenge } from "@/lib/webauthn";
import { createSession } from "@/lib/auth";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC — completes passkey sign-in and issues the session cookie.
 *
 * The credential the device chose is what identifies the account: we look the
 * passkey up by id and the row tells us whose it is. So the user is discovered
 * here rather than declared by the client.
 */
export async function POST(req: NextRequest) {
  const expectedChallenge = await takeChallenge();
  if (!expectedChallenge) {
    return NextResponse.json(
      { message: "Sign-in expired — try again." },
      { status: 400 },
    );
  }

  const { rpID, origin } = rpInfo(req);

  try {
    const body = await req.json();
    const passkey = await prisma.passkey.findUnique({
      where: { id: body.id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
            accountType: true,
          },
        },
      },
    });
    if (!passkey) {
      return NextResponse.json({ message: "Unknown passkey." }, { status: 404 });
    }

    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.id,
        publicKey: isoBase64URL.toBuffer(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports
          ? (passkey.transports.split(",") as ("internal" | "hybrid")[])
          : undefined,
      },
    });

    if (!verification.verified) {
      return NextResponse.json({ message: "Passkey sign-in failed." }, { status: 401 });
    }

    // Checked after verification, not before: an unapproved account shouldn't be
    // distinguishable from a wrong passkey until the passkey itself has proven out.
    if (passkey.user.status === "pending") {
      return NextResponse.json(
        { message: "This account is still waiting for an admin to approve it." },
        { status: 403 },
      );
    }
    if (passkey.user.status !== "active") {
      return NextResponse.json(
        { message: "This account has been disabled." },
        { status: 403 },
      );
    }

    // Persisting the signature counter is what makes cloned-authenticator
    // detection work on the next attempt.
    await prisma.passkey.update({
      where: { id: passkey.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    const { token } = await createSession(
      passkey.user.id,
      req.headers.get("user-agent"),
    );
    const res = NextResponse.json(passkey.user);
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return res;
  } catch (e) {
    return NextResponse.json(
      { message: (e as Error).message || "Passkey sign-in failed." },
      { status: 400 },
    );
  }
}
