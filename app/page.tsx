"use client";

import { useCallback, useEffect, useState } from "react";
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
import { useMembers } from "@/components/member-context";
import { api } from "@/services/api";
import { formatCurrency, formatDate, reminderStatus } from "@/lib/format";
import type { Activity, DashboardStats, Reminder } from "@/types";

export default function DashboardPage() {
  const { currentMember } = useMembers();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [upcoming, setUpcoming] = useState<Reminder[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, rem, act] = await Promise.all([
        api.reports.dashboard(),
        api.reminders.list(),
        api.reports.recentActivity(),
      ]);
      setStats(s);
      setUpcoming(
        rem
          .filter((r) => r.status === "active")
          .sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate))
          .slice(0, 5),
      );
      setActivity(act);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
    <div className="flex-1 space-y-4 p-4 md:p-8">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            {currentMember ? `Welcome back, ${currentMember.name}` : "All family reminders"}
          </p>
        </div>
        <Link href="/reminders">
          <Button>Add Reminder</Button>
        </Link>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{k.label}</CardTitle>
              <k.icon className={`h-4 w-4 ${k.tone}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${k.tone}`}>
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

      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-4">
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
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20">
                          <Calendar className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <h4 className="font-semibold">{r.title}</h4>
                          <p className="text-sm text-muted-foreground">
                            {r.category?.name} · {formatDate(r.dueDate)}
                          </p>
                        </div>
                      </div>
                      <span className={`text-sm font-medium ${st.className}`}>
                        {st.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
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
                        {a.member ? `${a.member} · ` : ""}
                        {formatDate(a.completedOn)}
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
