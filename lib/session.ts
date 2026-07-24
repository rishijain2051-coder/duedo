// Session tokens signed with the built-in Web Crypto API (HMAC-SHA256).
// Uses only Web-standard globals (crypto.subtle, TextEncoder, btoa/atob), so it
// runs identically in the Edge middleware and Node route handlers — no external
// deps, and no "unsupported module" warnings on Vercel Edge.

export const SESSION_COOKIE = "prosys_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
  memberId: string;
  name: string;
}

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

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  const body = {
    memberId: payload.memberId,
    name: payload.name,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  };
  const data = toB64Url(new TextEncoder().encode(JSON.stringify(body)));
  const sig = toB64Url(await hmac(data));
  return `${data}.${sig}`;
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  try {
    const expected = await hmac(data);
    if (!timingSafeEqual(expected, fromB64Url(sig))) return null;
    const body = JSON.parse(new TextDecoder().decode(fromB64Url(data)));
    if (typeof body.exp === "number" && body.exp * 1000 < Date.now()) return null;
    if (typeof body.memberId === "string" && typeof body.name === "string") {
      return { memberId: body.memberId, name: body.name };
    }
    return null;
  } catch {
    return null;
  }
}
