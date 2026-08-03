"use client";

import Link from "next/link";
import {
  Activity as ActivityIcon,
  Clock,
  CheckCircle2,
  Wallet,
  Calendar,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useApp } from "@/components/app-context";
import { useCached } from "@/lib/cache";
import { api } from "@/services/api";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  reminderStatus,
} from "@/lib/format";
import type { Activity, DashboardStats, Reminder } from "@/types";

export default function DashboardPage() {
  const { user, timeZone } = useApp();
  // Seeded from localStorage, so the numbers and list are on screen before the
  // request finishes. One request instead of three, and the server does the
  // sorting and top-5 slice rather than shipping every active reminder.
  const { data, loading, error } = useCached("overview", api.reports.overview);
  const stats: DashboardStats | null = data?.stats ?? null;
  const upcoming: Reminder[] = data?.upcoming ?? [];
  const activity: Activity[] = data?.activity ?? [];

  const kpis = [
    {
      label: "Total Active",
      value: stats?.totalActive ?? 0,
      icon: ActivityIcon,
      tone: "text-primary",
    },
    {
      label: "Due Today",
      value: stats?.dueToday ?? 0,
      icon: Clock,
      tone: "text-orange-500",
    },
    {
      label: "Overdue",
      value: stats?.overdue ?? 0,
      icon: Clock,
      tone: "text-red-500",
    },
    {
      label: "Completed (month)",
      value: stats?.completedThisMonth ?? 0,
      icon: CheckCircle2,
      tone: "text-green-500",
    },
  ];

  return (
    <div className="flex-1 space-y-3 p-4 md:space-y-4 md:p-8">
      <div className="flex items-center justify-between gap-2">
        {/* min-w-0 so a long subtitle can't push the button off the viewport */}
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold tracking-tight md:text-3xl">
            {user ? `Hi ${user.name.split(" ")[0]}` : "Dashboard"}
          </h2>
          <p className="truncate text-xs text-muted-foreground md:text-sm">
            {loading
              ? "…"
              : stats?.outstanding
                ? `${stats.outstanding} needing attention now`
                : "Nothing due right now"}
          </p>
        </div>
        <Link href="/reminders" className="shrink-0">
          <Button>
            <span className="md:hidden">Add</span>
            <span className="hidden md:inline">Add Reminder</span>
          </Button>
        </Link>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Two-up on phones: four full-width cards meant scrolling ~450px to read
          four numbers. */}
      <div className="grid grid-cols-2 gap-2 md:gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="min-w-0">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-2">
              <CardTitle className="truncate text-xs font-medium md:text-sm">
                {k.label}
              </CardTitle>
              <k.icon className={`h-4 w-4 shrink-0 ${k.tone}`} />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
              <div className={`text-xl font-bold md:text-2xl ${k.tone}`}>
                {loading ? "—" : k.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Estimated spend this month
          </CardTitle>
          <Wallet className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {loading ? "—" : formatCurrency(stats?.monthlySpend)}
          </div>
          <p className="text-xs text-muted-foreground">
            From reminders marked complete this month
          </p>
        </CardContent>
      </Card>

      {/* min-w-0 on the grid items is load-bearing: grid tracks size to min-content,
          and the truncated titles inside are white-space:nowrap, so without it the
          tracks blow past the viewport and body's overflow-hidden clips them away. */}
      <div className="grid gap-3 md:gap-4 lg:grid-cols-7">
        <Card className="min-w-0 lg:col-span-4">
          <CardHeader>
            <CardTitle>Upcoming Reminders</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
              </div>
            ) : upcoming.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">
                Nothing upcoming. 🎉
              </p>
            ) : (
              <div className="space-y-3">
                {upcoming.map((r) => {
                  const st = reminderStatus(r);
                  return (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-lg border p-3 glass"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20">
                          <Calendar className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="truncate font-semibold">{r.title}</h4>
                          <p className="text-sm text-muted-foreground">
                            {r.category?.name} ·{" "}
                            {formatDateTime(r.dueAt, r.hasTime, timeZone)}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 text-sm font-medium ${st.className}`}
                      >
                        {st.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-3">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
              </div>
            ) : activity.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">
                No completed reminders yet.
              </p>
            ) : (
              <div className="space-y-4">
                {activity.map((a) => (
                  <div key={a.id} className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-sm font-semibold">
                        {a.title}
                        {a.amount ? ` · ${formatCurrency(a.amount)}` : ""}
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(a.completedOn, timeZone)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
