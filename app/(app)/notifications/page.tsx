"use client";

import { useState } from "react";
import {
  AlarmClock,
  AlertTriangle,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  Hand,
  Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useApp } from "@/components/app-context";
import { useCached } from "@/lib/cache";
import { api } from "@/services/api";
import { formatDateTime } from "@/lib/format";
import type { AppNotification } from "@/types";

/**
 * Visual treatment per notification kind.
 *
 * All five the app writes: lib/dispatch.ts sends lead, due, overdue and escalation, and
 * the nudge route sends nudge. This listed only the first three, so a nudge from another
 * member and an escalation to somebody outside the app both fell through to the `due`
 * fallback and were labelled "Due" — a label that is simply untrue of them, on the two
 * kinds that most need to stand out.
 *
 * The fallback is now neutral rather than "Due", so a kind added later shows up as
 * unstyled instead of quietly claiming to be something it isn't.
 */
const KIND_STYLE: Record<
  string,
  { icon: typeof Bell; className: string; label: string }
> = {
  lead: { icon: BellRing, className: "bg-blue-500/15 text-blue-400", label: "Heads-up" },
  due: { icon: AlarmClock, className: "bg-orange-500/15 text-orange-400", label: "Due" },
  overdue: { icon: AlarmClock, className: "bg-red-500/15 text-red-400", label: "Overdue" },
  escalation: {
    icon: AlertTriangle,
    className: "bg-red-600/20 text-red-300",
    label: "Escalated",
  },
  nudge: { icon: Hand, className: "bg-violet-500/15 text-violet-400", label: "Nudge" },
};

const FALLBACK_STYLE = {
  icon: Bell,
  className: "bg-muted text-muted-foreground",
  label: "Alert",
};

export default function NotificationsPage() {
  const { timeZone, syncBadge } = useApp();
  const {
    data,
    loading,
    error: loadError,
    refresh: load,
    set: setItems,
  } = useCached("notifications", api.notifications.list);
  const items: AppNotification[] = data ?? [];
  const [error, setError] = useState<string | null>(null);

  async function markRead(id: string) {
    // Optimistic, and written straight to the cache so it survives navigation.
    setItems(items.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await api.notifications.markRead(id);
      // The bell count now lives in the app shell, so it has to be told.
      await syncBadge();
    } catch {
      load();
    }
  }

  async function markAll() {
    try {
      await api.notifications.markAllRead();
      await load();
      await syncBadge();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const unread = items.filter((n) => !n.read).length;

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8">
      {/* The tour points at the row, not at "Mark all read" — that button only exists
          while something is unread, and an anchor that comes and goes is a step that
          silently disappears. */}
      <div className="flex items-center justify-between gap-2" data-tour="notif-unread">
        <div className="min-w-0">
          <h2 className="text-xl md:text-3xl font-bold tracking-tight">
            Notifications
          </h2>
          <p className="text-sm text-muted-foreground">{unread} unread</p>
        </div>
        {unread > 0 && (
          <Button variant="outline" onClick={markAll}>
            <CheckCheck className="mr-2 h-4 w-4" /> Mark all read
          </Button>
        )}
      </div>

      {(error ?? loadError) && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-700 dark:text-red-400">
          {error ?? loadError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <Card data-tour="notif-list">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Bell className="h-8 w-8" />
            <p>No notifications yet.</p>
            <p className="text-xs">
              This log fills up as your reminders come due — it stays even if a
              push or email fails to reach you.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2" data-tour="notif-list">
          {items.map((n) => {
            const style = KIND_STYLE[n.kind] ?? FALLBACK_STYLE;
            const Icon = style.icon;
            return (
              <div
                key={n.id}
                className={`flex items-center justify-between gap-3 rounded-lg border p-4 transition-colors ${
                  n.read ? "bg-transparent" : "bg-primary/5 border-primary/30"
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${style.className}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{n.title}</p>
                    <p className="text-xs text-muted-foreground">{n.body}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {style.label} · {formatDateTime(n.createdAt, true, timeZone)}
                    </p>
                  </div>
                </div>
                {!n.read && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => markRead(n.id)}
                  >
                    <Check className="mr-1 h-4 w-4" /> Read
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
