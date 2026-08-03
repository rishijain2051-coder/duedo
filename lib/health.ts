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

export async function deliveryHealth(runLimit = RUN_LIST_LIMIT) {
  const now = Date.now();

  const [runs, failuresLast24h, failingDevices] = await Promise.all([
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
    runs: runs.map((r) => ({
      id: r.id,
      ranAt: r.ranAt,
      durationMs: r.durationMs,
      considered: r.considered,
      recipients: r.recipients,
      firedLead: r.firedLead,
      firedDue: r.firedDue,
      firedOverdue: r.firedOverdue,
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
