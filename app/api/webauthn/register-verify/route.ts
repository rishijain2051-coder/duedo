import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/http";
import { rpInfo, takeChallenge } from "@/lib/webauthn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const expectedChallenge = await takeChallenge();
  if (!expectedChallenge) {
    return NextResponse.json(
      { message: "Registration expired — start again." },
      { status: 400 },
    );
  }

  const { rpID, origin } = rpInfo(req);

  try {
    const body = await req.json();
    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json(
        { message: "Could not verify this passkey." },
        { status: 400 },
      );
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    // A credential belongs to exactly one account. If this id is already on file
    // under someone else, refuse rather than quietly moving it — silently
    // reassigning would hand them a working login to this account.
    const claimed = await prisma.passkey.findUnique({
      where: { id: credential.id },
      select: { userId: true },
    });
    if (claimed && claimed.userId !== user.id) {
      return NextResponse.json(
        { message: "That passkey is already registered to another account." },
        { status: 409 },
      );
    }

    await prisma.passkey.upsert({
      where: { id: credential.id },
      create: {
        id: credential.id,
        userId: user.id,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        transports: credential.transports?.join(",") ?? null,
        label: typeof body.label === "string" ? body.label.slice(0, 60) : "This device",
      },
      update: {
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
      },
    });

    return NextResponse.json({ verified: true });
  } catch (e) {
    return NextResponse.json(
      { message: (e as Error).message || "Passkey registration failed." },
      { status: 400 },
    );
  }
}
