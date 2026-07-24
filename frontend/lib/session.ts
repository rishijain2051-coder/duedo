import { SignJWT, jwtVerify } from "jose";

// Edge-safe (jose only): used by both middleware (Edge) and route handlers (Node).
export const SESSION_COOKIE = "prosys_session";

export interface SessionPayload {
  memberId: string;
  name: string;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(
    process.env.AUTH_SECRET || "dev-insecure-secret-change-me",
  );
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ memberId: payload.memberId, name: payload.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.memberId === "string" && typeof payload.name === "string") {
      return { memberId: payload.memberId, name: payload.name };
    }
    return null;
  } catch {
    return null;
  }
}
