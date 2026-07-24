import { NextRequest, NextResponse } from "next/server";
import { dispatchDueReminders } from "@/lib/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Triggered by Vercel Cron (HTTP GET). Vercel attaches
// `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const isServerless = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
  const authorization = req.headers.get("authorization");

  if (!secret) {
    if (isServerless) {
      return NextResponse.json({ message: "CRON_SECRET is not configured" }, { status: 401 });
    }
  } else if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ message: "Invalid or missing cron secret" }, { status: 401 });
  }

  try {
    const summary = await dispatchDueReminders();
    return NextResponse.json(summary);
  } catch (e) {
    console.error("[cron] dispatch failed:", e);
    return NextResponse.json({ message: (e as Error).message }, { status: 500 });
  }
}
