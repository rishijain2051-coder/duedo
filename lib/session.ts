// Cookie token primitives, signed with the built-in Web Crypto API (HMAC-SHA256).
// Uses only Web-standard globals (crypto.subtle, TextEncoder, btoa/atob), so it
// has no external deps and runs anywhere.
//
// Pure crypto and payload shaping only — no database. The session *lifecycle*
// (creating rows, idle expiry, revocation) lives in lib/auth.ts, which is
// Node-only. Keeping them apart means this file stays usable anywhere.
//
// The token deliberately carries no identity of its own: it names a Session row,
// and that row is what says which user it belongs to. Putting the user id in the
// token instead would make the login unrevocable — the whole point of a
// DB-backed session is that deleting the row ends it immediately.

export const SESSION_COOKIE = "prosys_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const SUBJECT = "session";

function secretBytes(): Uint8Array {
  return new TextEncoder().encode(
    process.env.AUTH_SECRET || "dev-insecure-secret-change-me",
  );
}

function toB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmac(dataB64: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes() as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(dataB64) as BufferSource,
  );
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Signs a token naming `sessionId`. */
export async function signToken(sessionId: string): Promise<string> {
  const body = {
    sub: SUBJECT,
    sid: sessionId,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const data = toB64Url(new TextEncoder().encode(JSON.stringify(body)));
  const sig = toB64Url(await hmac(data));
  return `${data}.${sig}`;
}

/**
 * Verifies signature and expiry, returning the session id it names.
 * Says nothing about whether that session still exists — that's lib/auth.ts.
 */
export async function readToken(token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  try {
    const expected = await hmac(data);
    if (!timingSafeEqual(expected, fromB64Url(sig))) return null;
    const body = JSON.parse(new TextDecoder().decode(fromB64Url(data)));
    if (typeof body.exp === "number" && body.exp * 1000 < Date.now()) return null;
    if (body.sub !== SUBJECT) return null;
    return typeof body.sid === "string" ? body.sid : null;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};

export const clearedSessionCookieOptions = {
  httpOnly: true,
  path: "/",
  maxAge: 0,
};
