import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { rpInfo, stashChallenge } from "@/lib/webauthn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC — this is the login step, so there is no session yet and we don't know
 * who is signing in.
 *
 * Note the absence of `allowCredentials`. Passkeys are registered as discoverable
 * (residentKey: "required"), so the device can offer whichever ones it holds and
 * tell us afterwards which was used. Listing credentials here instead would mean
 * publishing every registered credential id on this install to anyone who loads
 * the login page — a straightforward way to enumerate accounts. This endpoint
 * touches the database not at all, and so reveals nothing.
 */
export async function POST(req: NextRequest) {
  const { rpID } = rpInfo(req);

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
  });

  await stashChallenge(options.challenge);
  return NextResponse.json(options);
}
