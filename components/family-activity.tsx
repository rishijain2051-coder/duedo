"use client";

import { CheckCircle2, Flame, Loader2, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApp } from "@/components/app-context";
import { useCached } from "@/lib/cache";
import { api } from "@/services/api";
import { formatDateTime } from "@/lib/format";
import { formatINR } from "@/lib/money";

/**
 * What has been happening, and how everyone is doing.
 *
 * Two halves with different politics, which is why they are one component:
 *
 *   * the timeline is always on. A record of what happened is not the part that can go
 *     wrong socially, and it is the part that removes the phone call;
 *   * the scoreboard shows each member their own figures always, but only *orders* them
 *     against each other when the head has switched ranking on, and only shows streaks
 *     when streaks are on. A household that hasn't asked to be a league table isn't one.
 */
export function FamilyActivity({ familyId }: { familyId: string }) {
  const { timeZone } = useApp();
  const feed = useCached(`family-activity-${familyId}`, () => api.family.activity(familyId));
  const board = useCached(`family-scoreboard-${familyId}`, () =>
    api.family.scoreboard(familyId),
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">This month</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {board.loading ? (
            <div className="flex items-center px-4 py-6 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !board.data || board.data.members.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {board.data.members.map((m) => (
                <li key={m.userId} className="px-4 py-2.5 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">
                      {m.name}
                      {m.self && <span className="ml-2 text-xs text-primary">you</span>}
                    </p>
                    <p className="tabular-nums">
                      {m.assigned === 0 ? (
                        <span className="text-muted-foreground">nothing assigned</span>
                      ) : (
                        <>
                          {m.completed}/{m.assigned} done
                          {m.completed > 0 && (
                            <span className="text-muted-foreground">
                              {" · "}
                              {m.onTime} on time
                            </span>
                          )}
                        </>
                      )}
                    </p>
                  </div>
                  {board.data?.streaks && (m.streakWeeks ?? 0) + (m.streakMonths ?? 0) > 0 && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
                      <Flame className="h-3 w-3" />
                      {m.streakWeeks ? `${m.streakWeeks} week streak` : null}
                      {m.streakWeeks && m.streakMonths ? " · " : null}
                      {m.streakMonths ? `${m.streakMonths} month streak` : null}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {feed.loading ? (
            <div className="flex items-center px-4 py-6 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !feed.data || feed.data.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              Nothing has happened on this list yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {feed.data.map((e) => (
                <li key={e.id} className="flex gap-3 px-4 py-2.5 text-sm">
                  {e.kind === "completed" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                  ) : (
                    <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <p>
                      <span className="font-medium">{e.who}</span>{" "}
                      {e.kind === "completed" ? "completed" : "said something about"}{" "}
                      <span className="font-medium">{e.title}</span>
                      {e.amount > 0 && (
                        <span className="text-muted-foreground"> · {formatINR(e.amount)}</span>
                      )}
                    </p>
                    {e.body && (
                      <p className="mt-0.5 break-words text-muted-foreground">“{e.body}”</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(e.at, true, timeZone)}
                      {/* Only when it is knowable. A null means the completion predates
                          cycle recording, not that it was late. */}
                      {e.onTime === false && (
                        <span className="text-amber-600 dark:text-amber-400"> · late</span>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
