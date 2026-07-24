import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// This file runs on the Edge runtime. Keep it SELF-CONTAINED (no local imports)
// so Vercel never flags it as "referencing unsupported modules". The session
// verification below mirrors lib/session.ts (keep in sync) but uses only
// Web-standard globals (crypto.subtle, TextEncoder, atob), which Edge supports.

const SESSION_COOKIE = "prosys_session";

// Endpoints reachable without a login session.
const PUBLIC_API = [
  "/api/auth/members",
  "/api/auth/login",
  "/api/cron/dispatch",
  "/api/health",
];

function fromB64Url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifySession(
  token: string,
): Promise<{ memberId: string; name: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(
        process.env.AUTH_SECRET || "dev-insecure-secret-change-me",
      ) as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(data) as BufferSource,
      ),
    );
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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (pathname.startsWith("/api")) {
    const isPublic = PUBLIC_API.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    );
    if (isPublic) return NextResponse.next();
    if (!session) {
      return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Pages
  if (pathname === "/login") {
    if (session) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp)$).*)"],
};
