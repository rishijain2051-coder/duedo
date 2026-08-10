"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScopeTabs } from "@/components/scope-tabs";
import { useApp } from "@/components/app-context";
import { useCached } from "@/lib/cache";
import { api } from "@/services/api";
import { formatDateTime } from "@/lib/format";
import { formatINR } from "@/lib/money";

/**
 * Spending awareness — not accounting.
 *
 * It answers "what have I been spending and what's about to land". Deliberately not a
 * budgeting tool: no envelopes, no financial year, no reconciliation. The whole appeal
 * over something like YNAB is that there is nothing to set up.
 */

/** Bars, hand-rolled. A charting library is ~100 kB for what this does in 20 lines. */
function Bars({
  rows,
}: {
  rows: { name: string; spent: number; trend?: number | null }[];
}) {
  const max = Math.max(...rows.map((r) => r.spent), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.name}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{r.name}</span>
            <span className="shrink-0 font-medium tabular-nums">
              {formatINR(r.spent)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max(2, (r.spent / max) * 100)}%` }}
              />
            </div>
            {/* Only shown when there was enough history to mean something — see
                MIN_BASELINE_MONTHS in the route. */}
            {typeof r.trend === "number" && r.trend !== 0 && (
              <span
                className={`flex shrink-0 items-center gap-0.5 text-xs ${
                  r.trend > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-green-600 dark:text-green-400"
                }`}
                title="Against this category's own average of the last 3 months"
              >
                {r.trend > 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {Math.abs(r.trend)}%
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Twelve months as a sparkline-ish bar row. Same reasoning: SVG beats a dependency. */
function YearBars({
  months,
  timeZone,
}: {
  months: { month: string; spent: number }[];
  timeZone: string | undefined;
}) {
  const max = Math.max(...months.map((m) => m.spent), 1);
  const label = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", { month: "short", timeZone });

  return (
    <div className="flex items-end gap-1" style={{ height: 96 }}>
      {months.map((m) => (
        <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-primary/70"
            style={{ height: `${Math.max(2, (m.spent / max) * 72)}px` }}
            title={`${label(m.month)} · ${formatINR(m.spent)}`}
          />
          <span className="w-full truncate text-center text-[10px] text-muted-foreground">
            {label(m.month)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function InsightsPage() {
  const { scope, timeZone } = useApp();
  const [showYear, setShowYear] = useState(false);

  const month = useCached(`insights-${scope}`, () => api.insights.month(scope));
  // Only fetched once asked for. A year is twelve rollup rows, but it is still a request
  // nobody needs on the way to reading this month's total.
  const year = useCached(showYear ? `insights-year-${scope}` : "insights-year-idle", () =>
    showYear ? api.insights.year(scope) : Promise.resolve(null),
  );

  const d = month.data;

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8">
      <div>
        <h2 className="text-xl font-bold tracking-tight md:text-3xl">Spending</h2>
        <p className="text-xs text-muted-foreground md:text-sm">
          From reminders marked complete, with whatever amount was recorded.
        </p>
      </div>

      <ScopeTabs />

      {/* A paywall is not a fault. 402 gets the ordinary card and a way forward; a real
          failure keeps the red banner it deserves. */}
      {month.errorStatus === 402 && !d ? (
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">{month.error}</p>
            <Link
              href="/upgrade"
              className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-all hover:bg-primary/90 sm:h-9"
            >
              See plans
            </Link>
          </CardContent>
        </Card>
      ) : (
        month.error &&
        !d && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-700 dark:text-red-400">
            {month.error}
          </div>
        )
      )}

      {month.loading ? (
        <div className="flex items-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : !d ? null : (
        <>
          <div className="grid gap-2 md:gap-4 lg:grid-cols-3">
            <Card className="min-w-0">
              <CardHeader className="p-3 pb-1 md:p-6 md:pb-2">
                <CardTitle className="text-xs font-medium md:text-sm">
                  This month
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-xl font-bold md:text-2xl">
                  {formatINR(d.spent)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {d.completions} paid
                </p>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader className="p-3 pb-1 md:p-6 md:pb-2">
                <CardTitle className="text-xs font-medium md:text-sm">
                  Next {d.forecast.days} days
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-xl font-bold md:text-2xl">
                  {formatINR(d.forecast.total)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {d.forecast.items.length} due
                </p>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader className="p-3 pb-1 md:p-6 md:pb-2">
                <CardTitle className="text-xs font-medium md:text-sm">On time</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="text-xl font-bold md:text-2xl">
                  {/* Dash, not 0%, when nothing this month recorded the cycle it
                      settled — "unknown" and "you missed everything" are very
                      different messages to put on a screen. */}
                  {d.onTime ? `${d.onTime.met}/${d.onTime.of}` : "—"}
                </div>
                <p className="text-xs text-muted-foreground">
                  {d.onTime ? "completed by the due date" : "nothing recorded yet"}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">By category</CardTitle>
            </CardHeader>
            <CardContent>
              {d.categories.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nothing completed this month yet.
                </p>
              ) : (
                <Bars rows={d.categories} />
              )}
            </CardContent>
          </Card>

          {d.forecast.items.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Due in the next {d.forecast.days} days
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {d.forecast.items.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-baseline justify-between gap-2 px-4 py-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(r.dueAt, r.hasTime, timeZone)}
                        </p>
                      </div>
                      <span className="shrink-0 tabular-nums">
                        {r.amount > 0 ? formatINR(r.amount) : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-sm">Last 12 months</CardTitle>
              {!showYear && (
                <Button variant="outline" size="sm" onClick={() => setShowYear(true)}>
                  Show
                </Button>
              )}
            </CardHeader>
            {showYear && (
              <CardContent className="space-y-3">
                {year.loading || !year.data ? (
                  <div className="flex items-center py-6 text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
                  </div>
                ) : (
                  <>
                    <p className="text-2xl font-bold">{formatINR(year.data.total)}</p>
                    <YearBars months={year.data.months} timeZone={timeZone} />
                    <Bars rows={year.data.categories.map((c) => ({ ...c }))} />
                  </>
                )}
              </CardContent>
            )}
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <a href={api.insights.exportUrl(scope)} download>
              <Button variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" /> Download CSV
              </Button>
            </a>
            {/* Said plainly rather than discovered from a total that looks wrong. */}
            <p className="text-xs text-muted-foreground">
              Last 3 months, payment by payment. Older months are kept as monthly totals
              only, and deleting a reminder removes its history.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
