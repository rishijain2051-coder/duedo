import { NextRequest, NextResponse } from "next/server";
import { dispatchDueReminders } from "@/lib/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called once a minute by Supabase pg_cron, which sends
// `Authorization: Bearer <CRON_SECRET>`. See DEPLOY.md for the SQL.
//
// Both verbs are accepted: pg_net's net.http_post is the documented setup, while
// GET keeps the endpoint easy to poke by hand.

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const isServerless =
    process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
  const authorization = req.headers.get("authorization");

  if (!secret) {
    // Unauthenticated dispatch is only tolerable on a local dev box.
    if (isServerless) {
      return NextResponse.json(
        { message: "CRON_SECRET is not configured" },
        { status: 401 },
      );
    }
  } else if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json(
      { message: "Invalid or missing cron secret" },
      { status: 401 },
    );
  }

  // Dev-only time travel. The engine's decisions are all relative to "now", and
  // verifying lead/due/overdue spacing otherwise means waiting out real minutes.
  // Refused in production, and the cron secret is still required either way.
  let now: Date | undefined;
  const nowParam = req.nextUrl.searchParams.get("now");
  if (nowParam) {
    if (isServerless) {
      return NextResponse.json(
        { message: "The 'now' override is not available in production." },
        { status: 400 },
      );
    }
    const parsed = new Date(nowParam);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { message: `Could not parse now="${nowParam}"` },
        { status: 400 },
      );
    }
    now = parsed;
  }

  try {
    const summary = await dispatchDueReminders(now);
    return NextResponse.json(summary);
  } catch (e) {
    console.error("[cron] dispatch failed:", e);
    return NextResponse.json({ message: (e as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
