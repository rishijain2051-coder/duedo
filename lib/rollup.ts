import { prisma } from "./db";
import { round2 } from "./money";
import { zonedMonthStart, zonedMonthStartOffset } from "./time";

// Closing months, and pruning the detail behind them.
//
// Two jobs that have to agree, so they live together: a month is totalled into
// MonthlyRollup, and only once that has happened may its individual completions be
// deleted. Past three months the rollup is the *only* record of what was spent, which is
// what makes the ordering non-negotiable.
//
// Both ride the existing daily tick rather than a schedule of their own. That tick is
// already the one thing guaranteed to run every minute; a second cron job would be a
// second thing that can silently stop, and there is nothing here that needs its own.

/**
 * Complete months kept as individual completions, beyond the current one.
 *
 * Chosen so that anything eligible for pruning has had three separate days to be rolled
 * up. A month only becomes a prune candidate at offset -4, by which point the close pass
 * has looked at it three times.
 */
const DETAIL_MONTHS = 3;

/** How far back the close pass looks for a month it never totalled. */
const CLOSE_LOOKBACK = DETAIL_MONTHS;

/** Bound on one month's completions, so a runaway list can't build an unbounded query. */
const MAX_ROWS_PER_MONTH = 10_000;

/**
 * Runs on one tick in 360 — roughly four times a day.
 *
 * The audit rotation can afford a per-tick check because its guard is a single indexed
 * lookup. This one has to enumerate every scope before it can tell whether there is
 * anything to do, so a per-minute run would be hundreds of queries a minute to discover
 * that mid-month there is nothing to close. Sampling deterministically off the epoch
 * minute is the same trick sweepRetention already uses in lib/dispatch.ts.
 *
 * Missing a day costs nothing: closing is idempotent, and CLOSE_LOOKBACK means a month
 * skipped today is picked up tomorrow.
 */
const TICK_INTERVAL = 360;

export interface RollupResult {
  ran: boolean;
  scopes: number;
  monthsClosed: number;
  rowsRolled: number;
  rowsPruned: number;
  /** Months skipped because they had no rollup — the one case that must never prune. */
  prunesRefused: number;
}

interface ScopeRef {
  scopeKey: string;
  timeZone: string;
  /** Exactly one of these. */
  userId?: string;
  familyId?: string;
}

/**
 * Every scope that can own money, with the timezone its months are measured in.
 *
 * A personal scope uses its own account's zone. A family uses its **head's**, because a
 * household needs one answer to "when did August end" and the head is the only member
 * defined to exist. Members in other zones see the same month boundaries as each other,
 * which is what makes a shared total add up.
 */
async function scopeList(): Promise<ScopeRef[]> {
  const users = await prisma.user.findMany({
    where: { status: "active" },
    select: { id: true, timezone: true },
  });

  const heads = await prisma.familyMember.findMany({
    where: { role: "head" },
    select: { familyId: true, user: { select: { timezone: true } } },
  });

  return [
    ...users.map((u) => ({ scopeKey: `u:${u.id}`, timeZone: u.timezone, userId: u.id })),
    ...heads.map((h) => ({
      scopeKey: `f:${h.familyId}`,
      timeZone: h.user.timezone,
      familyId: h.familyId,
    })),
  ];
}

/** History belonging to one scope. Mirrors lib/history-scope.ts; see the note there. */
function scopeFilter(scope: ScopeRef) {
  return scope.userId
    ? { reminder: { userId: scope.userId, familyId: null } }
    : { reminder: { familyId: scope.familyId } };
}

/**
 * Totals one month for one scope, if it hasn't been totalled already.
 *
 * Returns the number of history rows that went in, or null when the month was already
 * closed. Idempotent through the unique key on (scopeKey, month, categoryKey), so a
 * second run in the same day is a no-op rather than a doubling.
 */
async function closeMonth(
  scope: ScopeRef,
  monthStart: Date,
  monthEnd: Date,
): Promise<number | null> {
  const already = await prisma.monthlyRollup.findFirst({
    where: { scopeKey: scope.scopeKey, month: monthStart },
    select: { id: true },
  });
  if (already) return null;

  const rows = await prisma.reminderHistory.findMany({
    where: {
      ...scopeFilter(scope),
      completedOn: { gte: monthStart, lt: monthEnd },
    },
    take: MAX_ROWS_PER_MONTH,
    select: {
      amount: true,
      reminder: {
        select: { categoryId: true, category: { select: { name: true } } },
      },
    },
  });

  // Grouped here rather than in SQL because categoryId lives on Reminder, not on the
  // history row — a groupBy would need a raw query, and a month of one household's
  // completions is a few dozen rows.
  const byCategory = new Map<string, { name: string; spent: number; count: number }>();
  for (const r of rows) {
    const key = r.reminder?.categoryId ?? "none";
    const name = r.reminder?.category?.name ?? "Uncategorised";
    const bucket = byCategory.get(key) ?? { name, spent: 0, count: 0 };
    bucket.spent += typeof r.amount === "number" ? r.amount : 0;
    bucket.count += 1;
    byCategory.set(key, bucket);
  }

  // An empty month still gets a marker row. Without it the close pass would re-examine
  // every quiet month forever, and — far worse — the prune would find no rollup and
  // correctly refuse to ever clean it up.
  const data =
    byCategory.size > 0
      ? [...byCategory].map(([categoryKey, b]) => ({
          scopeKey: scope.scopeKey,
          month: monthStart,
          categoryKey,
          categoryName: b.name,
          spent: round2(b.spent),
          completions: b.count,
        }))
      : [
          {
            scopeKey: scope.scopeKey,
            month: monthStart,
            categoryKey: "none",
            categoryName: "Nothing recorded",
            spent: 0,
            completions: 0,
          },
        ];

  await prisma.monthlyRollup.createMany({ data, skipDuplicates: true });
  return rows.length;
}

/**
 * Deletes the completions behind months that are already totalled and old enough.
 *
 * Three rules, and they are the whole reason this function is separate from the close:
 *
 *   * a month with no rollup row is never pruned, whatever its age — if the close failed,
 *     the detail is the only copy that exists;
 *   * only months at DETAIL_MONTHS + 1 and older are eligible, so anything deleted has
 *     been offered to the close pass three times;
 *   * the delete names explicit ids. A `completedOn < cutoff` range would be one typo
 *     away from taking the current month with it, and there is no undo.
 */
async function pruneScope(
  scope: ScopeRef,
  now: Date,
): Promise<{ pruned: number; refused: number }> {
  let pruned = 0;
  let refused = 0;

  // Everything older than the retained window, in this scope's own months. Walking month
  // by month rather than using one cutoff is what lets each month be checked against its
  // own rollup.
  const oldest = await prisma.reminderHistory.findFirst({
    where: scopeFilter(scope),
    orderBy: { completedOn: "asc" },
    select: { completedOn: true },
  });
  if (!oldest) return { pruned, refused };

  const boundary = zonedMonthStartOffset(now, scope.timeZone, -DETAIL_MONTHS);
  if (oldest.completedOn >= boundary) return { pruned, refused };

  for (let back = DETAIL_MONTHS + 1; back <= 120; back++) {
    const monthStart = zonedMonthStartOffset(now, scope.timeZone, -back);
    const monthEnd = zonedMonthStartOffset(now, scope.timeZone, -back + 1);
    if (monthEnd <= oldest.completedOn) break; // walked past the oldest row

    const rows = await prisma.reminderHistory.findMany({
      where: { ...scopeFilter(scope), completedOn: { gte: monthStart, lt: monthEnd } },
      select: { id: true },
      take: MAX_ROWS_PER_MONTH,
    });
    if (rows.length === 0) continue;

    const rollup = await prisma.monthlyRollup.findFirst({
      where: { scopeKey: scope.scopeKey, month: monthStart },
      select: { id: true },
    });
    if (!rollup) {
      refused += rows.length;
      continue;
    }

    const deleted = await prisma.reminderHistory.deleteMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });
    pruned += deleted.count;
  }

  return { pruned, refused };
}

/**
 * Closes any month that hasn't been totalled, then prunes what is safe to prune.
 *
 * Never throws: this is housekeeping riding the reminder tick, and reminders matter more
 * than a spending total being one day late. A failure for one scope doesn't stop the rest.
 */
export async function runMonthlyMaintenance(
  now = new Date(),
  /** Set by the dev-only `?rollup=1`, so a test doesn't have to wait for the sample. */
  force = false,
): Promise<RollupResult> {
  const idle: RollupResult = {
    ran: false,
    scopes: 0,
    monthsClosed: 0,
    rowsRolled: 0,
    rowsPruned: 0,
    prunesRefused: 0,
  };
  if (!force && Math.floor(now.getTime() / 60_000) % TICK_INTERVAL !== 0) return idle;

  const scopes = await scopeList();
  const result: RollupResult = {
    ran: true,
    scopes: scopes.length,
    monthsClosed: 0,
    rowsRolled: 0,
    rowsPruned: 0,
    prunesRefused: 0,
  };

  for (const scope of scopes) {
    try {
      for (let back = 1; back <= CLOSE_LOOKBACK; back++) {
        const monthStart = zonedMonthStartOffset(now, scope.timeZone, -back);
        const monthEnd =
          back === 1
            ? zonedMonthStart(now, scope.timeZone)
            : zonedMonthStartOffset(now, scope.timeZone, -back + 1);
        const rolled = await closeMonth(scope, monthStart, monthEnd);
        if (rolled !== null) {
          result.monthsClosed++;
          result.rowsRolled += rolled;
        }
      }

      const { pruned, refused } = await pruneScope(scope, now);
      result.rowsPruned += pruned;
      result.prunesRefused += refused;
    } catch (e) {
      console.error(`[rollup] scope ${scope.scopeKey} failed:`, (e as Error).message);
    }
  }

  return result;
}
