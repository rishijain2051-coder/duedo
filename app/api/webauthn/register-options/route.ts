import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/http";
import { rpInfo, stashChallenge, rpName } from "@/lib/webauthn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Enrolling a passkey requires an existing PIN session — you prove it's you first. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const { rpID } = rpInfo(req);
  const existing = await prisma.passkey.findMany({ where: { userId: user.id } });

  const options = await generateRegistrationOptions({
    rpName: rpName(),
    rpID,
    // The account's own id and email, so the platform's passkey list shows who
    // the credential belongs to — which is the whole point once more than one
    // person can use this install.
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    // Stops the platform silently creating a second credential for the same key.
    excludeCredentials: existing.map((p) => ({
      id: p.id,
      transports: p.transports
        ? (p.transports.split(",") as ("internal" | "hybrid")[])
        : undefined,
    })),
    authenticatorSelection: {
      // platform = the device's own biometrics (Face ID / Hello), not a USB key.
      authenticatorAttachment: "platform",
      // Required, and load-bearing: a discoverable credential is what lets the
      // login page authenticate without first being told who is signing in.
      residentKey: "required",
      userVerification: "required",
    },
  });

  await stashChallenge(options.challenge);
  return NextResponse.json(options);
}
