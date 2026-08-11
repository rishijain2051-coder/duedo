import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * Sends a signed-in visitor at the root straight to the app.
 *
 * The root is the public landing page. Someone who already has an account has no use
 * for the pitch, and the alternative — checking the session inside `app/page.tsx` —
 * would make the landing a dynamic render on every anonymous hit too. Doing it here
 * keeps the page a static document for the visitors it is actually written for, which
 * is the whole thing a landing page is judged on.
 *
 * Presence, not validity. Verifying the signature would mean crypto on every root
 * request to answer a question `/dashboard` asks again properly a moment later: an
 * expired or forged cookie lands there and AppProvider bounces it to /login, which is
 * the same place a wrong answer here would have sent it. The only cost of trusting the
 * cookie is that a stale one takes the long way round to the PIN screen.
 *
 * lib/session.ts is safe to import from the edge runtime — it is Web Crypto and
 * constants, with the database deliberately kept out in lib/auth.ts.
 */
export function middleware(req: NextRequest) {
  if (req.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  return NextResponse.next();
}

/**
 * The root and nothing else.
 *
 * Deliberately not a pattern with exclusions. This middleware exists for exactly one
 * URL, and a broad matcher would put an edge hop in front of every asset and every
 * authenticated route to answer a question none of them asked.
 */
export const config = { matcher: "/" };
