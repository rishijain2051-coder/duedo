"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Check, CheckCheck, Loader2, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";
import { formatDate } from "@/lib/format";
import type { AppNotification } from "@/types";

export default function NotificationsPage() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.notifications.list());
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

  async function markRead(id: string) {
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    try {
      await api.notifications.markRead(id);
    } catch {
      load();
    }
  }

  async function markAll() {
    try {
      await api.notifications.markAllRead();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const unread = items.filter((n) => !n.read).length;

  return (
    <div className="flex-1 space-y-4 p-6 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Notifications</h2>
          <p className="text-sm text-muted-foreground">
            Family notifications · {unread} unread
          </p>
        </div>
        {unread > 0 && (
          <Button variant="outline" onClick={markAll}>
            <CheckCheck className="mr-2 h-4 w-4" /> Mark all read
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Bell className="h-8 w-8" />
            <p>No notifications yet.</p>
            <p className="text-xs">
              The daily reminder job creates these when items are due.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <div
              key={n.id}
              className={`flex items-center justify-between rounded-lg border p-4 transition-colors ${
                n.read ? "bg-transparent" : "bg-primary/5 border-primary/30"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full ${
                    n.channel === "email"
                      ? "bg-blue-500/15 text-blue-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {n.channel === "email" ? (
                    <Mail className="h-4 w-4" />
                  ) : (
                    <Bell className="h-4 w-4" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">{n.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {n.user?.name ? `${n.user.name} · ` : ""}
                    {formatDate(n.createdAt)}
                    {n.channel === "email" ? " · emailed" : ""}
                  </p>
                </div>
              </div>
              {!n.read && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => markRead(n.id)}
                >
                  <Check className="mr-1 h-4 w-4" /> Read
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
