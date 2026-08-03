import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The build currently deployed. Public and deliberately trivial — a client
 * compares this against the NEXT_PUBLIC_BUILD_ID baked into its own bundle, and a
 * mismatch means the app on screen was served by an older deployment.
 *
 * This matters most for an installed PWA, which can otherwise keep running a
 * stale page for a long time without ever telling you.
 */
export async function GET() {
  return NextResponse.json(
    { buildId: process.env.APP_BUILD_ID || "unknown" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
