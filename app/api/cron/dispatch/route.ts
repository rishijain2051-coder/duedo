import { NextRequest, NextResponse } from "next/server";
import { dispatchDueReminders, recordFailedRun } from "@/lib/dispatch";
import { rotateAuditLogIfDue } from "@/lib/audit-rotate";
import { runMonthlyMaintenance } from "@/lib/rollup";
import { advanceStreaks } from "@/lib/streaks";

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

  const startedAt = Date.now();
  try {
    const summary = await dispatchDueReminders(now);

    // Piggy-backed on the minute tick rather than given its own schedule: this is
    // already the one thing guaranteed to run, and a second cron job would be a
    // second thing that can silently stop. rotateAuditLogIfDue() decides for itself
    // whether the day has turned, so all but one call a day is a single indexed
    // lookup. It never throws — a rotation problem must not take dispatch down with
    // it, because reminders matter more than log housekeeping.
    // Dev-only, same rules as `now` above. Both sides of the send are forceable,
    // because neither can be provoked for real:
    //
    //   failAuditMail=1 — the send reports failure, which is the only way to test
    //     "nothing is deleted unless the mail was accepted". A genuine SMTP rejection
    //     isn't dependable: an address at a reserved .invalid domain is *accepted* at
    //     submission and bounces later, so a test built on it deletes the log while
    //     looking like proof it wouldn't.
    //   fakeAuditMail=1 — the send reports success without sending, which is the only
    //     way to reach the *delete* path at all. A test admin necessarily has a
    //     reserved-domain address, and lib/mail.ts now refuses those outright, so the
    //     real sender can never succeed for one.
    const failSend = req.nextUrl.searchParams.get("failAuditMail") === "1";
    const fakeSend = req.nextUrl.searchParams.get("fakeAuditMail") === "1";
    if ((failSend || fakeSend) && isServerless) {
      return NextResponse.json(
        { message: "The audit mail overrides are not available in production." },
        { status: 400 },
      );
    }
    if (failSend && fakeSend) {
      return NextResponse.json(
        { message: "Pick one of failAuditMail or fakeAuditMail." },
        { status: 400 },
      );
    }

    // Also dev-only. Month close and history pruning normally run on one tick in 360,
    // which a test can't wait for — and pruning is destructive, so it must not be
    // forceable in production.
    const forceRollup = req.nextUrl.searchParams.get("rollup") === "1";
    if (forceRollup && isServerless) {
      return NextResponse.json(
        { message: "The rollup override is not available in production." },
        { status: 400 },
      );
    }

    let audit:
      | Awaited<ReturnType<typeof rotateAuditLogIfDue>>
      | { error: string }
      | { ran: false; reason: string };

    // Not while the clock is being overridden. `?now=` exists so the engine's
    // lead/due/overdue spacing can be tested without waiting out real minutes, and
    // the dispatch suite drives it months into the future — which made the rotation
    // believe a new day had turned, mail a dump to the real admin, and delete the
    // log. Time travel must stay inside the engine: it decides what to *send*, and
    // sending is already dedupe-guarded, but mailing the owner and clearing an audit
    // trail are one-way doors.
    if (nowParam) {
      audit = { ran: false, reason: "skipped: the clock is overridden" };
    } else {
      try {
        const override = failSend
          ? async () => false
          : fakeSend
            ? async () => true
            : undefined;
        audit = await rotateAuditLogIfDue(now, override);
      } catch (e) {
        console.error("[cron] audit rotation failed:", e);
        audit = { error: (e as Error).message };
      }
    }

    // Same reasoning as the audit rotation above: it rides this tick because this tick
    // is the one thing guaranteed to run, it decides for itself whether a month has
    // turned, and it must never take dispatch down with it. Skipped under `?now=` for
    // the same reason the rotation is — closing a month and deleting the detail behind
    // it are one-way doors, and time travel exists to test the *engine*.
    let rollup: Awaited<ReturnType<typeof runMonthlyMaintenance>> | { error: string } | null =
      null;
    let streaks: Awaited<ReturnType<typeof advanceStreaks>> | { error: string } | null = null;
    if (!nowParam) {
      try {
        rollup = await runMonthlyMaintenance(now, forceRollup);
      } catch (e) {
        console.error("[cron] monthly maintenance failed:", e);
        rollup = { error: (e as Error).message };
      }
      try {
        streaks = await advanceStreaks(now, forceRollup);
      } catch (e) {
        console.error("[cron] streak advance failed:", e);
        streaks = { error: (e as Error).message };
      }
    }

    return NextResponse.json({ ...summary, audit, rollup, streaks });
  } catch (e) {
    console.error("[cron] dispatch failed:", e);
    // Recorded, not just logged: a dispatcher that has been throwing for a day
    // looks identical to an idle one from the outside, and the admin health page
    // is where that difference has to be visible.
    await recordFailedRun((e as Error).message, Date.now() - startedAt);
    return NextResponse.json({ message: (e as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
