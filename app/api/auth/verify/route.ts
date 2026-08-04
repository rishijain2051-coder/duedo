import { NextRequest, NextResponse } from "next/server";
import { verifyEmailToken } from "@/lib/verify-email";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC — the link from the verification email.
 *
 * GET, and it changes state, which is normally the wrong shape. It is unavoidable
 * here: a mail client can only follow a link, and asking someone to copy a token into
 * a form to prove they read an email defeats the point. The mitigations are that the
 * token is single-use, expires in 24 hours, and grants exactly one thing — activating
 * the account it was issued for. It creates no session, so a link that leaks in a
 * forwarded email cannot be used to *read* anything; the PIN is still required.
 *
 * Redirects rather than returning JSON, because a person is looking at this in a
 * browser. /login reads the query flag and says what happened.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const result = await verifyEmailToken(token);

  const to = (params: Record<string, string>) => {
    const url = new URL("/login", req.nextUrl.origin);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    // 303, so a refresh of the landing page doesn't re-submit the spent token.
    return NextResponse.redirect(url, 303);
  };

  if (!result.ok) return to({ verified: result.reason });

  if (!result.alreadyVerified) {
    await audit({
      actorId: null,
      action: "user.verify.email",
      entity: "user",
      detail: { email: result.email },
    });
  }

  return to({ verified: "ok", email: result.email });
}
