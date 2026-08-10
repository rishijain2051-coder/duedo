import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { percentChange, round2, sumAmounts } from "@/lib/money";
import { zonedMonthStart, zonedMonthStartOffset } from "@/lib/time";
import {
  categoryNames,
  historyScopeWhere,
  parseScope,
  reminderScopeWhere,
} from "@/lib/history-scope";
import { assertFeature } from "@/lib/plan-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Months of trailing data used as the baseline a trend is measured against. */
const TREND_BASELINE_MONTHS = 3;

/**
 * Enough baseline months to say anything at all.
 *
 * Two, not one: a single prior month makes every ordinary fluctuation look like a trend,
 * and "23% higher than last month" for a bill that alternates is noise dressed as
 * insight. Below this the response says `trend: null` and the page shows nothing.
 */
const MIN_BASELINE_MONTHS = 2;

/** How far ahead the cash-flow line looks. */
const FORECAST_DAYS = 7;

/**
 * This month's spending, per category, with a trend and a short forecast.
 *
 * Reads ReminderHistory rather than Reminder, so it does **not** pass through
 * lib/ownership.ts — see lib/history-scope.ts for why that needed its own scope rule.
 */
export async function GET(req: NextRequest) {
  return json(async (user) => {
    // Reading only, and still gated — Spending is a paid surface. Nothing is deleted
    // or stopped by a lapse: the completions these figures are built from keep being
    // written, so the view fills back in the moment access resumes.
    assertFeature(user, "spending");
    const scope = parseScope(req.nextUrl.searchParams.get("scope"));
    const now = new Date();
    const tz = user.timezone;

    const where = await historyScopeWhere(user.id, scope);
    const monthStart = zonedMonthStart(now, tz);
    const baselineStart = zonedMonthStartOffset(now, tz, -TREND_BASELINE_MONTHS);

    const [thisMonth, baseline, upcoming] = await Promise.all([
      prisma.reminderHistory.findMany({
        where: { ...where, completedOn: { gte: monthStart } },
        select: {
          amount: true,
          completedOn: true,
          cycleDueAt: true,
          reminder: { select: { categoryId: true } },
        },
      }),
      // The complete months before this one. Deliberately excludes the current month:
      // comparing a month against an average that includes itself flattens the very
      // change the number exists to show.
      prisma.reminderHistory.findMany({
        where: {
          ...where,
          completedOn: { gte: baselineStart, lt: monthStart },
        },
        select: {
          amount: true,
          completedOn: true,
          reminder: { select: { categoryId: true } },
        },
      }),
      prisma.reminder.findMany({
        where: {
          ...(await reminderScopeWhere(user.id, scope)),
          status: "active",
          dueAt: {
            gte: now,
            lt: new Date(now.getTime() + FORECAST_DAYS * 86_400_000),
          },
        },
        orderBy: { dueAt: "asc" },
        select: { id: true, title: true, dueAt: true, hasTime: true, amount: true },
      }),
    ]);

    const ids = [
      ...thisMonth.map((r) => r.reminder?.categoryId ?? ""),
      ...baseline.map((r) => r.reminder?.categoryId ?? ""),
    ];
    const names = await categoryNames(ids);
    const label = (id: string | undefined) =>
      (id && names.get(id)) || "Uncategorised";

    // How many distinct complete months the baseline actually covers, per category. A
    // category that only appeared last month has one, and gets no trend.
    const baselineMonths = new Map<string, Set<string>>();
    const baselineTotals = new Map<string, number>();
    for (const r of baseline) {
      const key = r.reminder?.categoryId ?? "none";
      const month = `${r.completedOn.getUTCFullYear()}-${r.completedOn.getUTCMonth()}`;
      (baselineMonths.get(key) ?? baselineMonths.set(key, new Set()).get(key)!).add(month);
      baselineTotals.set(key, (baselineTotals.get(key) ?? 0) + (r.amount ?? 0));
    }

    const current = new Map<string, { spent: number; count: number }>();
    for (const r of thisMonth) {
      const key = r.reminder?.categoryId ?? "none";
      const b = current.get(key) ?? { spent: 0, count: 0 };
      b.spent += r.amount ?? 0;
      b.count += 1;
      current.set(key, b);
    }

    const categories = [...current]
      .map(([key, b]) => {
        const months = baselineMonths.get(key)?.size ?? 0;
        const mean =
          months >= MIN_BASELINE_MONTHS
            ? (baselineTotals.get(key) ?? 0) / months
            : null;
        return {
          categoryId: key === "none" ? null : key,
          name: label(key === "none" ? undefined : key),
          spent: round2(b.spent),
          completions: b.count,
          /** Percent above/below this category's own trailing mean, or null. */
          trend: mean === null ? null : percentChange(b.spent, mean),
          baselineMonths: months,
        };
      })
      .sort((a, b) => b.spent - a.spent);

    // On-time rate for the month. Rows written before cycleDueAt existed are excluded
    // rather than counted as late — a null there means "unknown", not "missed".
    const judged = thisMonth.filter((r) => r.cycleDueAt !== null);
    const onTime = judged.filter((r) => r.completedOn <= r.cycleDueAt!).length;

    return {
      scope,
      month: monthStart,
      spent: sumAmounts(thisMonth.map((r) => r.amount)),
      completions: thisMonth.length,
      categories,
      onTime: judged.length > 0 ? { of: judged.length, met: onTime } : null,
      forecast: {
        days: FORECAST_DAYS,
        total: sumAmounts(upcoming.map((r) => r.amount)),
        items: upcoming.map((r) => ({
          id: r.id,
          title: r.title,
          dueAt: r.dueAt,
          hasTime: r.hasTime,
          amount: r.amount ?? 0,
        })),
      },
    };
  });
}
