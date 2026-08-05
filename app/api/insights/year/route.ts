import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { round2, sumAmounts } from "@/lib/money";
import { zonedMonthStart, zonedMonthStartOffset } from "@/lib/time";
import {
  categoryNames,
  historyScopeWhere,
  parseScope,
  scopeKeyFor,
} from "@/lib/history-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Twelve months back, inclusive of the current one. */
const MONTHS = 12;

/**
 * A rolling twelve months of spending.
 *
 * Reads MonthlyRollup for closed months and computes the current one live, because the
 * current month has not been closed yet and won't be until it ends. Detail older than
 * three months is pruned, so for most of the window the rollup is the only record — which
 * is exactly what it exists for.
 *
 * Calendar months and a rolling year, not a financial year. This is a reminder app; it
 * answers "roughly what have I been spending", and anything that turned it into a filing
 * aid would be a promise it shouldn't make.
 */
export async function GET(req: NextRequest) {
  return json(async (user) => {
    const scope = parseScope(req.nextUrl.searchParams.get("scope"));
    const now = new Date();
    const tz = user.timezone;

    // Membership is checked here even though the rollup query keys off scopeKey — the
    // key is derived from the request, so without this a family id would read straight
    // out of another household's totals.
    const where = await historyScopeWhere(user.id, scope);
    const scopeKey = scopeKeyFor(user.id, scope);

    const monthStart = zonedMonthStart(now, tz);
    const windowStart = zonedMonthStartOffset(now, tz, -(MONTHS - 1));

    const [closed, live] = await Promise.all([
      prisma.monthlyRollup.findMany({
        where: { scopeKey, month: { gte: windowStart, lt: monthStart } },
        orderBy: { month: "asc" },
      }),
      // The whole window, not just this month.
      //
      // A month is only closed once the daily maintenance pass reaches it, so at any
      // moment the recent months have detail and no rollup. Reading only rollups plus the
      // current month therefore silently omitted them: the dashboard listed three
      // payments while this view totalled one, and two screens in the same app disagreed
      // about the same money. Each month below takes its rollup if it has one and its
      // detail otherwise, so the figure is right whether or not the close has run.
      prisma.reminderHistory.findMany({
        where: { ...where, completedOn: { gte: windowStart } },
        select: {
          amount: true,
          completedOn: true,
          reminder: { select: { categoryId: true } },
        },
      }),
    ]);

    const names = await categoryNames(live.map((r) => r.reminder?.categoryId ?? ""));

    // One bucket per month in the window, so a month with nothing recorded is a zero on
    // the chart rather than a gap the eye reads as missing data.
    const buckets = new Map<string, { month: Date; spent: number; completions: number }>();
    for (let i = MONTHS - 1; i >= 0; i--) {
      const m = zonedMonthStartOffset(now, tz, -i);
      buckets.set(m.toISOString(), { month: m, spent: 0, completions: 0 });
    }

    const byCategory = new Map<string, { name: string; spent: number }>();

    /** Which months already have a rollup, so their detail must not be counted twice. */
    const rolled = new Set(closed.map((r) => r.month.toISOString()));

    for (const row of closed) {
      const b = buckets.get(row.month.toISOString());
      if (b) {
        b.spent += row.spent;
        b.completions += row.completions;
      }
      // A closed month with nothing in it is stored as a single marker row, so that the
      // close pass knows it is done and the prune knows the month is safe to clean. It is
      // bookkeeping, not a category, and listing it puts "Nothing recorded — ₹0" in the
      // breakdown.
      if (row.completions === 0 && row.spent === 0) continue;
      const c = byCategory.get(row.categoryKey) ?? { name: row.categoryName, spent: 0 };
      c.spent += row.spent;
      byCategory.set(row.categoryKey, c);
    }

    // Bucket starts newest-first, so the first one at or before a completion is its month.
    const starts = [...buckets.values()].map((b) => b.month).reverse();
    const bucketFor = (at: Date) =>
      starts.find((s) => s <= at)?.toISOString() ?? null;

    for (const row of live) {
      const key = bucketFor(row.completedOn);
      // Either outside the window, or in a month the rollup has already accounted for.
      if (!key || rolled.has(key)) continue;

      const bucket = buckets.get(key)!;
      bucket.spent += row.amount ?? 0;
      bucket.completions += 1;

      const cat = row.reminder?.categoryId ?? "none";
      const c =
        byCategory.get(cat) ?? { name: names.get(cat) ?? "Uncategorised", spent: 0 };
      c.spent += row.amount ?? 0;
      byCategory.set(cat, c);
    }

    const months = [...buckets.values()].map((b) => ({
      month: b.month,
      spent: round2(b.spent),
      completions: b.completions,
    }));

    return {
      scope,
      from: windowStart,
      to: monthStart,
      total: sumAmounts(months.map((m) => m.spent)),
      months,
      categories: [...byCategory]
        .map(([categoryKey, c]) => ({
          categoryId: categoryKey === "none" ? null : categoryKey,
          name: c.name,
          spent: round2(c.spent),
        }))
        .sort((a, b) => b.spent - a.spent),
      /** So the page can say the older months are summaries, not a payment list. */
      detailFrom: zonedMonthStartOffset(now, tz, -3),
    };
  });
}
