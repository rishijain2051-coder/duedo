import { NextResponse } from "next/server";
import { destroyCurrentSession } from "@/lib/auth";
import { SESSION_COOKIE, clearedSessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  // Delete the row as well as the cookie, so a captured token can't be replayed.
  await destroyCurrentSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", clearedSessionCookieOptions);
  return res;
}
