import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC (pre-login) endpoint. Tells the login page whether this is a fresh
 * install, so it can offer "create the first account" instead of a sign-in form.
 *
 * Returns a single boolean and nothing else: no names, no emails, no count. The
 * old version of this endpoint listed every member so the login page could show a
 * name picker, which with private reminders would leak who has an account here.
 */
export async function GET() {
  const count = await prisma.user.count();
  return NextResponse.json({ setupNeeded: count === 0 });
}
