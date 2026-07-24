import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Endpoints reachable without a login session.
const PUBLIC_API = [
  "/api/auth/members", // login screen needs the member list
  "/api/auth/login",
  "/api/cron/dispatch", // secured separately by CRON_SECRET
  "/api/health",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

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
  // Run on everything except Next internals and static asset files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp)$).*)"],
};
