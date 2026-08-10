import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

// WebAuthn plumbing for biometric sign-in (Face ID, Touch ID, Windows Hello).
// The PIN is always kept as the fallback, so a lost or reset passkey never locks
// anyone out of their account.

export function rpName(): string {
  return process.env.APP_NAME || "DueDo";
}

const CHALLENGE_COOKIE = "duedo_webauthn_challenge";
const CHALLENGE_TTL_SECONDS = 300;

/**
 * Relying-party ID and expected origin, derived from the request.
 *
 * rpID must be the bare domain with no port or scheme. Behind Vercel the
 * x-forwarded-* headers are authoritative, since req.url reports the internal host.
 *
 * Derived rather than configured, which has one consequence worth stating plainly:
 * **a passkey is bound to the domain it was created on.** Moving the app — as the
 * PRO-SYS to DueDo rename did — means every existing passkey stops being offered,
 * because the browser will not present a credential registered for another rpID.
 * Nobody is locked out (the PIN is always kept as the fallback, see above), but
 * everyone re-enrols Face ID once. Any future domain move costs the same again.
 */
export function rpInfo(req: NextRequest): { rpID: string; origin: string } {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || url.host;
  const proto =
    req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return { rpID: host.split(":")[0], origin: `${proto}://${host}` };
}

/**
 * Parks the challenge in an httpOnly cookie for the round trip.
 *
 * This is server-owned state the client can't read. Even if a caller could force
 * a known challenge, completing the ceremony still requires the private key held
 * in the device's secure element, so replacing it buys an attacker nothing.
 */
export async function stashChallenge(challenge: string): Promise<void> {
  const store = await cookies();
  store.set(CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CHALLENGE_TTL_SECONDS,
  });
}

export async function takeChallenge(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(CHALLENGE_COOKIE)?.value ?? null;
  if (value) {
    // Single-use: clear it so a captured response can't be replayed.
    store.set(CHALLENGE_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return value;
}
