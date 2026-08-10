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
                ? "Configured."
                : "Set SMTP_HOST, SMTP_USER and SMTP_PASS to enable email."
            }
          />
          <Flag
            ok={data.pushConfigured}
            label="Push (VAPID)"
            hint={
              data.pushConfigured
                ? "Configured."
                : "Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY."
            }
          />
          <Flag
            ok={data.cronSecretSet}
            label="CRON_SECRET"
            hint={
              data.cronSecretSet
                ? "Set."
                : "Not set. In production the dispatcher refuses every call, so nothing is ever sent."
            }
          />
          <Flag
            ok={!stale}
            label="Scheduler"
            hint={
              data.lastRunMinutesAgo === null
                ? "Never run. Is the Supabase pg_cron job scheduled?"
                : stale
                  ? `Last ran ${data.lastRunMinutesAgo} minutes ago — it should run every minute.`
                  : `Last ran ${data.lastRunMinutesAgo} minute${data.lastRunMinutesAgo === 1 ? "" : "s"} ago.`
            }
          />
          {/* Asked of Postgres, not inferred from the app's own rows. When the
              dispatcher is never reached there is no DispatchRun to explain why,
              which is exactly when this is the only thing that can tell you. */}
          <Flag
            ok={data.scheduler.pgNetInstalled}
            label="pg_net extension"
            hint={
              data.scheduler.pgNetInstalled
                ? "Installed."
                : // The schema matters: without it the extension lands in `public`,
                  // which Supabase's own linter flags.
                  "Missing. pg_cron will fire and fail on net.http_post, so nothing reaches the app. Run: create extension if not exists pg_net with schema extensions;"
            }
          />
          <Flag
            ok={data.scheduler.jobScheduled && data.scheduler.jobActive}
            label="pg_cron job"
            hint={
              !data.scheduler.readable
                ? "Could not read the cron catalogs — this says nothing about whether the job works."
                : !data.scheduler.jobScheduled
                  ? "No job named duedo-dispatch. Run scripts/pg-cron-setup.sql."
                  : data.scheduler.jobActive
                    ? `Active. Last tick ${data.scheduler.lastTickStatus ?? "unknown"}.`
                    : "Scheduled but inactive — it will never fire."
            }
          />
        </CardContent>
      </Card>

      {data.scheduler.lastTickError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-700 dark:text-red-400">
          <p className="font-medium">Postgres could not run the scheduled job</p>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">
            {data.scheduler.lastTickError}
          </p>
          <p className="mt-1 text-xs">
            This is the database&rsquo;s own error, before the app was reached — so no
            dispatch run was recorded for it.
          </p>
        </div>
      )}

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
          <CardTitle className="text-sm">Last 3 dispatch runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.runs.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No runs recorded yet.
            </p>
          ) : (
            <>
              {/* Phones get a list. As a sideways-scrolling table the last two
                  columns — Email and Took — were off the edge of the screen, and a
                  scroll gesture inside a table is easy to miss on touch. */}
              <ul className="divide-y divide-border sm:hidden">
                {data.runs.map((r) => (
                  <li
                    key={r.id}
                    className={`space-y-1 px-3 py-2.5 text-sm ${r.error ? "bg-destructive/10" : ""}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-medium">
                        {formatDateTime(r.ranAt, true, timeZone)}
                      </p>
                      <p className="text-xs text-muted-foreground">{r.durationMs}ms</p>
                    </div>
                    {/* The alert breakdown includes escalations. firedEscalation is
                        recorded on every run precisely so this page can answer "why was
                        somebody outside the app written to", and it was being shown on
                        none of them — which left that question unanswerable here. */}
                    {r.error ? (
                      <p className="text-xs text-red-700 dark:text-red-400">{r.error}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {r.considered} considered · {r.firedLead}/{r.firedDue}/
                        {r.firedOverdue}/{r.firedEscalation} alerts · {r.recipients} sent
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {r.pushesSent} push
                      {r.pushesFailed > 0 && (
                        <span className="text-destructive"> ({r.pushesFailed} failed)</span>
                      )}{" "}
                      · {r.emailsSent} email
                      {/* Only when there is one, and never in the failure colour.
                          Somebody on Free not being emailed is the paywall working;
                          shown red it would read as delivery breaking. Without it,
                          "3 alerts, 1 email" looks like two emails went missing. */}
                      {r.emailsSkippedPlan > 0 && (
                        <span> · {r.emailsSkippedPlan} on Free</span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Considered</th>
                    <th className="px-3 py-2 font-medium">Lead/Due/Overdue/Esc</th>
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
                          : `${r.firedLead}/${r.firedDue}/${r.firedOverdue}/${r.firedEscalation} · ${r.recipients} sent`}
                      </td>
                      <td className="px-3 py-2">
                        {r.pushesSent}
                        {r.pushesFailed > 0 && (
                          <span className="text-destructive"> ({r.pushesFailed} failed)</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.emailsSent}
                        {/* Muted, and only when non-zero — this is the paywall working,
                            not delivery failing. It sits beside the email count because
                            that is the number it explains. */}
                        {r.emailsSkippedPlan > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            · {r.emailsSkippedPlan} on Free
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {r.durationMs}ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
