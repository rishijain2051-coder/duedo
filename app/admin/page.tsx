"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCached } from "@/lib/cache";
import { api } from "@/services/api";

/** Landing page: the numbers, and anything currently wrong. */
export default function AdminOverviewPage() {
  const { data, loading, error } = useCached("admin-overview", api.admin.overview);

  if (loading) {
    return (
      <div className="flex items-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-700 dark:text-red-400">
        {error ?? "Could not load."}
      </div>
    );
  }

  const h = data.health;
  // Everything that would make the app quietly stop delivering.
  const problems: string[] = [];
  if (!h.cronSecretSet)
    problems.push("CRON_SECRET is not set — the dispatcher refuses every call in production.");
  if (!h.mailConfigured && !h.pushConfigured)
    problems.push("Neither email nor push is configured, so nothing can be delivered.");
  if (h.lastRunMinutesAgo === null)
    problems.push("The dispatcher has never run. Is the Supabase pg_cron job scheduled?");
  else if (h.lastRunMinutesAgo > 10)
    problems.push(`The dispatcher last ran ${h.lastRunMinutesAgo} minutes ago — it should run every minute.`);
  if (h.failuresLast24h > 0)
    problems.push(`${h.failuresLast24h} dispatch run(s) failed in the last 24 hours.`);
  if (data.users.pending > 0)
    problems.push(`${data.users.pending} account(s) waiting for approval.`);

  const tiles = [
    { label: "Accounts", value: data.users.total, hint: `${data.users.active} active` },
    { label: "Waiting", value: data.users.pending, hint: "need approval" },
    { label: "Families", value: data.families, hint: "" },
    { label: "Reminders", value: data.reminders.active, hint: `${data.reminders.overdue} overdue` },
    { label: "Devices", value: data.devices.total, hint: `${data.devices.blocked} revoked` },
    { label: "Admins", value: data.users.admins, hint: "" },
  ];

  return (
    <div className="space-y-4">
      {problems.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
          <span>
            Everything looks healthy. Dispatcher last ran {h.lastRunMinutesAgo} minute
            {h.lastRunMinutesAgo === 1 ? "" : "s"} ago.
          </span>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" /> Needs attention
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 md:gap-4 lg:grid-cols-3">
        {tiles.map((t) => (
          <Card key={t.label} className="min-w-0">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-2">
              <CardTitle className="truncate text-xs font-medium md:text-sm">
                {t.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
              <div className="text-xl font-bold md:text-2xl">{t.value}</div>
              {t.hint && (
                <p className="text-xs text-muted-foreground">{t.hint}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Delivery detail is on the{" "}
        <Link href="/admin/health" className="text-primary underline">
          Health
        </Link>{" "}
        tab.
      </p>
    </div>
  );
}
