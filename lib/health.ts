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
