import { prisma } from "./db";
import { isPushConfigured } from "./push";
import { isMailConfigured } from "./mail";

// Delivery health, for the admin panel.
//
// The point of this module is that a broken dispatcher and an idle one look
// identical from the outside — both send nothing. Persisted DispatchRun rows are
// what tell them apart, so the answer to "is delivery working?" comes from
// evidence rather than from configuration flags alone.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Kept short on purpose: a wall of near-identical rows hides the one that matters. */
export const RUN_LIST_LIMIT = 3;

interface SchedulerState {
  /** null when the database wouldn't answer — not the same as "broken". */
  readable: boolean;
  pgCronInstalled: boolean;
  pgNetInstalled: boolean;
  jobScheduled: boolean;
  jobActive: boolean;
  lastTickAt: Date | null;
  lastTickStatus: string | null;
  lastTickError: string | null;
  /** null when pg_net has no response on file — not the same as "failed". */
  lastCallAt: Date | null;
  lastCallStatus: number | null;
  lastCallBody: string | null;
}

/**
 * Asks Postgres directly whether the scheduler is in a state to fire.
 *
 * Worth the extra queries because "no runs recently" has several causes that look
 * identical on the admin page, and one of them actually happened: `pg_net` was
 * dropped from the database, so pg_cron fired every minute and failed on
 * `net.http_post` with nothing anywhere in the app to say so. The dispatcher was
 * never reached, so there was no DispatchRun row to record a failure — the only
 * symptom was a stale "last ran" and a red flag with no explanation.
 *
 * The second failure mode is worse, because pg_cron calls it a success. `net.http_post`
 * only *queues* the request and returns a row id, so `cron.job_run_details.status` says
 * "succeeded" as soon as the statement runs — it cannot know what the app replied, or
 * whether anything answered at all. This install spent 3,580 consecutive ticks marked
 * succeeded while every one of them got `404 DEPLOYMENT_NOT_FOUND` from a Vercel project
 * that had been deleted in a rename. The tick status is therefore reported but never
 * trusted on its own; `net._http_response` is where the truth is.
 *
 * Everything here is best-effort. The cron catalogs need privileges the app's role
 * may not keep forever, so a failure sets `readable: false` rather than breaking
 * the page that is supposed to be diagnosing the problem.
 */
async function schedulerState(): Promise<SchedulerState> {
  const blank: SchedulerState = {
    readable: false,
    pgCronInstalled: false,
    pgNetInstalled: false,
    jobScheduled: false,
    jobActive: false,
    lastTickAt: null,
    lastTickStatus: null,
    lastTickError: null,
    lastCallAt: null,
    lastCallStatus: null,
    lastCallBody: null,
  };

  try {
    const extensions = await prisma.$queryRaw<{ extname: string }[]>`
      select extname from pg_extension where extname in ('pg_cron', 'pg_net')
    `;
    const names = new Set(extensions.map((e) => e.extname));

    const jobs = await prisma.$queryRaw<{ jobname: string; active: boolean }[]>`
      select jobname, active from cron.job where jobname = 'duedo-dispatch'
    `;

    const ticks = await prisma.$queryRaw<
      { status: string; start_time: Date; return_message: string | null }[]
    >`
      select d.status, d.start_time, d.return_message
      from cron.job_run_details d
      join cron.job j on j.jobid = d.jobid
      where j.jobname = 'duedo-dispatch'
      order by d.start_time desc
      limit 1
    `;
    const tick = ticks[0];

    // What the app actually replied. There is no url or jobid on this table, so this
    // cannot be joined to the job — it is simply the most recent outbound call pg_net
    // made, and the dispatch job is the only thing in this database that calls it.
    //
    // pg_net expires these after a few hours (measured: 360 rows, a six-hour window at
    // a call a minute), so an absent row means "nothing called recently", which is
    // already covered by the staleness check above. It must not read as a failure.
    //
    // Caught separately from the cron catalogs on purpose: `net` is a different schema
    // with its own grants, and losing it must not blank out the job facts next to it —
    // those are the ones that say whether anything is scheduled at all.
    let call: {
      status_code: number | null;
      content: string | null;
      error_msg: string | null;
      created: Date;
    } | undefined;
    try {
      const calls = await prisma.$queryRaw<NonNullable<typeof call>[]>`
        select status_code, content, error_msg, created
        from net._http_response
        order by created desc
        limit 1
      `;
      call = calls[0];
    } catch {
      call = undefined;
    }

    return {
      readable: true,
      pgCronInstalled: names.has("pg_cron"),
      pgNetInstalled: names.has("pg_net"),
      jobScheduled: jobs.length > 0,
      jobActive: jobs[0]?.active === true,
      lastTickAt: tick?.start_time ?? null,
      lastTickStatus: tick?.status ?? null,
      // Only the failure text is surfaced; a success message is just "1 row".
      lastTickError:
        tick && tick.status !== "succeeded" ? (tick.return_message?.trim() ?? null) : null,
      lastCallAt: call?.created ?? null,
      lastCallStatus: call?.status_code ?? null,
      // A transport failure (DNS, TLS, timeout) leaves status_code null and the reason
      // in error_msg; an HTTP failure puts the reason in the body. Whichever exists is
      // the actionable sentence — "DEPLOYMENT_NOT_FOUND" is what named the real cause
      // here. Truncated because a Next.js error page is a screenful of HTML.
      lastCallBody: call
        ? ((call.error_msg ?? call.content)?.trim().slice(0, 300) || null)
        : null,
    };
  } catch {
    return blank;
  }
}

export async function deliveryHealth(runLimit = RUN_LIST_LIMIT) {
  const now = Date.now();

  const [runs, failuresLast24h, failingDevices, scheduler] = await Promise.all([
    prisma.dispatchRun.findMany({ orderBy: { ranAt: "desc" }, take: runLimit }),
    prisma.dispatchRun.count({
      where: { error: { not: null }, ranAt: { gte: new Date(now - DAY_MS) } },
    }),
    prisma.pushSubscription.findMany({
      where: { failures: { gt: 0 }, blockedAt: null },
      orderBy: { failures: "desc" },
      take: 10,
      include: { user: { select: { name: true } } },
    }),
    schedulerState(),
  ]);

  const last = runs[0];

  return {
    mailConfigured: isMailConfigured(),
    pushConfigured: isPushConfigured(),
    // Without it the cron endpoint refuses every request in production, which is
    // the single most likely reason for total silence.
    cronSecretSet: Boolean(process.env.CRON_SECRET),
    lastRunMinutesAgo: last
      ? Math.floor((now - last.ranAt.getTime()) / 60_000)
      : null,
    lastRunError: last?.error ?? null,
    failuresLast24h,
    scheduler,
    runs: runs.map((r) => ({
      id: r.id,
      ranAt: r.ranAt,
      durationMs: r.durationMs,
      considered: r.considered,
      recipients: r.recipients,
      firedLead: r.firedLead,
      firedDue: r.firedDue,
      firedOverdue: r.firedOverdue,
      firedEscalation: r.firedEscalation,
      pushesSent: r.pushesSent,
      pushesFailed: r.pushesFailed,
      emailsSent: r.emailsSent,
      emailsSkippedPlan: r.emailsSkippedPlan,
      error: r.error,
    })),
    failingDevices: failingDevices.map((d) => ({
      id: d.id,
      label: d.label,
      user: d.user.name,
      failures: d.failures,
    })),
  };
}
