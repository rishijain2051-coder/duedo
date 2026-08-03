"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApp } from "@/components/app-context";
import { useCached } from "@/lib/cache";
import { api } from "@/services/api";
import { formatDateTime } from "@/lib/format";

function Flag({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <div className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

/**
 * Delivery health.
 *
 * The run history is the point of this page: configuration flags tell you whether
 * delivery *could* work, and only the runs tell you whether it *is*.
 */
export default function AdminHealthPage() {
  const { timeZone } = useApp();
  const { data, loading, error } = useCached("admin-health", api.admin.health);

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

  const stale = data.lastRunMinutesAgo === null || data.lastRunMinutesAgo > 10;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Flag
            ok={data.mailConfigured}
            label="Email (SMTP)"
            hint={
              data.mailConfigured
                ? "Configured — accounts with email on will be mailed."
                : "Set SMTP_HOST, SMTP_USER and SMTP_PASS to enable email."
            }
          />
          <Flag
            ok={data.pushConfigured}
            label="Push (VAPID)"
            hint={
              data.pushConfigured
                ? "Configured — enrolled devices can be reached."
                : "Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY."
            }
          />
          <Flag
            ok={data.cronSecretSet}
            label="CRON_SECRET"
            hint={
              data.cronSecretSet
                ? "Set — the dispatcher will accept the scheduler's calls."
                : "Not set. In production the dispatcher refuses every call, so nothing is ever sent."
            }
          />
          <Flag
            ok={!stale}
            label="Scheduler"
            hint={
              data.lastRunMinutesAgo === null
                ? "The dispatcher has never run. Is the Supabase pg_cron job scheduled?"
                : `Last ran ${data.lastRunMinutesAgo} minute${data.lastRunMinutesAgo === 1 ? "" : "s"} ago. It should run every minute.`
            }
          />
        </CardContent>
      </Card>

      {data.lastRunError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-700 dark:text-red-400">
          Last run failed: {data.lastRunError}
        </div>
      )}

      {data.failuresLast24h > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          {data.failuresLast24h} run(s) failed in the last 24 hours.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent dispatch runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.runs.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No runs recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Considered</th>
                    <th className="px-3 py-2 font-medium">Alerts</th>
                    <th className="px-3 py-2 font-medium">Push</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Took</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.runs.map((r) => (
                    <tr key={r.id} className={r.error ? "bg-destructive/10" : ""}>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {formatDateTime(r.ranAt, true, timeZone)}
                      </td>
                      <td className="px-3 py-2">{r.considered}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {r.error
                          ? "—"
                          : `${r.firedLead}/${r.firedDue}/${r.firedOverdue} · ${r.recipients} sent`}
                      </td>
                      <td className="px-3 py-2">
                        {r.pushesSent}
                        {r.pushesFailed > 0 && (
                          <span className="text-destructive"> ({r.pushesFailed} failed)</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{r.emailsSent}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {r.durationMs}ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Alerts column reads lead/due/overdue. A run with zeros everywhere is the
        normal idle result — it means the engine ran and had nothing to send.
      </p>

      {data.failingDevices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Devices failing to receive</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border rounded-md border">
              {data.failingDevices.map((d) => (
                <li key={d.id} className="px-3 py-2 text-sm">
                  <span className="font-medium">{d.label ?? "Device"}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {d.user} · {d.failures} consecutive failure
                    {d.failures === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Dropped automatically after five in a row, or immediately if the push
              service says the subscription is gone.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
