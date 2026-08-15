"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useApp } from "@/components/app-context";
import { useCached } from "@/lib/cache";
import { projectReminders, useOutbox } from "@/lib/offline";
import { api } from "@/services/api";
import { formatCurrency, formatTime, toDateKey } from "@/lib/format";
import { INSTALL_TIME_ZONE, firstOfMonthIn } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Reminder } from "@/types";

const DAYS_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const DAYS_FULL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Stable identity, so an empty result doesn't invalidate useMemo every render. */
const NO_REMINDERS: Reminder[] = [];

const pad = (n: number) => String(n).padStart(2, "0");
/** Matches the "YYYY-MM-DD" shape toDateKey() produces for a stored instant. */
const cellKey = (year: number, month: number, day: number) =>
  `${year}-${pad(month + 1)}-${pad(day)}`;

export default function CalendarPage() {
  const { timeZone } = useApp();
  // Cached: flipping between months shouldn't re-spinner, and a repeat visit
  // paints the grid before the request lands.
  const { data, loading } = useCached("reminders", api.reminders.list);
  // Projected like the reminders list, so a bill completed offline moves to its next
  // date here too rather than the two pages disagreeing about the same reminder.
  const { items: queued } = useOutbox();
  const reminders = useMemo(
    () => projectReminders(data ?? NO_REMINDERS, queued, timeZone),
    [data, queued, timeZone],
  );
  /**
   * Which month the grid opens on. Pinned to the install's zone rather than read off
   * the process clock, because this runs during render on both sides: `new Date()`
   * with getMonth() is the server's month, and for the last five and a half hours of
   * every month that is not the reader's — the header rendered August against markup
   * that said September, and the page hydrated against the wrong month.
   *
   * Not the *user's* zone, which is deliberate: settings have not loaded during the
   * first render, so there is nothing to read, and a value that changed once they
   * arrived would move the grid under someone already looking at it.
   */
  const [cursor, setCursor] = useState(() => firstOfMonthIn(INSTALL_TIME_ZONE));
  /**
   * Which day the phone-sized list below the grid is showing.
   *
   * Only used under `sm`, where a cell is about 36px wide and can't show a title.
   * Starts on today so the page opens on something rather than an instruction.
   */
  const [selected, setSelected] = useState<string | null>(null);

  const showMonth = (d: Date) => {
    setCursor(d);
    // The selection belongs to the month on screen; keeping it would leave the
    // list showing a day nobody can see.
    setSelected(null);
  };

  const byDay = useMemo(() => {
    const map = new Map<string, Reminder[]>();
    for (const r of reminders) {
      // Grouped by the calendar day the reminder falls on in the user's own zone,
      // so a late-evening reminder doesn't jump to the next day via UTC.
      const key = toDateKey(r.dueAt, timeZone);
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt));
    }
    return map;
  }, [reminders, timeZone]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = toDateKey(new Date(), timeZone);

  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const goToday = () => {
    const n = new Date();
    setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
    setSelected(todayKey);
  };

  // Falls back to today, which is only on screen while the user hasn't paged away —
  // and in another month there is nothing sensible to preselect.
  const monthPrefix = `${year}-${pad(month + 1)}`;
  const activeKey = selected ?? (todayKey.startsWith(monthPrefix) ? todayKey : null);
  const activeItems = activeKey ? (byDay.get(activeKey) ?? []) : [];

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl md:text-3xl font-bold tracking-tight">Calendar</h2>
        <div className="flex items-center gap-2" data-tour="cal-nav">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous month"
            onClick={() => showMonth(new Date(year, month - 1, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-36 md:w-40 text-center text-base md:text-lg font-semibold">
            {MONTHS[month]} {year}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next month"
            onClick={() => showMonth(new Date(year, month + 1, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="default" size="sm" onClick={goToday}>
            Today
          </Button>
        </div>
      </div>

      <Card data-tour="cal-grid">
        <CardContent className="p-0">
          <div className="grid grid-cols-7 border-b border-border">
            {DAYS_FULL.map((d, i) => (
              <div
                key={d}
                className="p-2 md:p-3 text-center text-xs md:text-sm font-semibold text-muted-foreground"
              >
                <span className="sm:hidden">{DAYS_SHORT[i]}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="grid auto-rows-[64px] grid-cols-7 divide-x divide-y divide-border sm:auto-rows-[90px] md:auto-rows-[110px]">
              {cells.map((day, i) => {
                if (day === null) return <div key={i} className="bg-muted/10" />;
                const key = cellKey(year, month, day);
                const items = byDay.get(key) ?? [];
                const isToday = key === todayKey;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelected(key)}
                    aria-pressed={activeKey === key}
                    className={cn(
                      "flex flex-col items-start gap-1 overflow-hidden p-1.5 text-left transition-colors hover:bg-muted/30",
                      // Kept at every width so a click always does something visible.
                      // Below sm it also drives the day list under the grid.
                      activeKey === key && "bg-primary/5",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm",
                        isToday && "bg-primary font-bold text-primary-foreground",
                        !isToday && activeKey === key && "ring-1 ring-primary",
                      )}
                    >
                      {day}
                    </span>

                    {/* Phone: dots only. A cell is ~36px wide here, so a title chip
                        showed three or four characters of it — and `title=` is a
                        hover tooltip, which touch has no way to open. The dots say
                        something is on this day; the list below the grid says what. */}
                    <span className="flex flex-wrap items-center gap-1 sm:hidden">
                      {items.slice(0, 4).map((r) => (
                        <span
                          key={r.id}
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: r.category?.color ?? "#64748b" }}
                        />
                      ))}
                      {items.length > 4 && (
                        <span className="text-[9px] leading-none text-muted-foreground">
                          +{items.length - 4}
                        </span>
                      )}
                    </span>

                    <span className="hidden w-full min-w-0 flex-col gap-1 sm:flex">
                      {items.slice(0, 2).map((r) => {
                        const color = r.category?.color ?? "#64748b";
                        return (
                          <span
                            key={r.id}
                            className="truncate rounded px-1.5 py-0.5 text-xs font-medium"
                            style={{ backgroundColor: `${color}22`, color }}
                            title={`${r.hasTime ? formatTime(r.dueAt, timeZone) + " — " : ""}${r.title}`}
                          >
                            {r.hasTime && (
                              <span className="mr-1 opacity-70">
                                {formatTime(r.dueAt, timeZone).replace(/\s?[ap]m$/i, "")}
                              </span>
                            )}
                            {r.title}
                          </span>
                        );
                      })}
                      {items.length > 2 && (
                        <span className="px-1 text-[10px] text-muted-foreground md:text-xs">
                          +{items.length - 2} more
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Phone only: the readable half of the calendar. Above sm the chips in the
          cells already say what's there. */}
      <Card className="sm:hidden">
        <CardContent className="p-3">
          {activeKey === null ? (
            <p className="py-2 text-center text-sm text-muted-foreground">
              Tap a day to see what&rsquo;s on it.
            </p>
          ) : activeItems.length === 0 ? (
            <p className="py-2 text-center text-sm text-muted-foreground">
              Nothing on {activeKey.slice(8).replace(/^0/, "")} {MONTHS[month]}.
            </p>
          ) : (
            <ul className="space-y-2">
              {activeItems.map((r) => (
                <li key={r.id} className="flex items-start gap-2">
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: r.category?.color ?? "#64748b" }}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.hasTime ? `${formatTime(r.dueAt, timeZone)} · ` : ""}
                      {r.category?.name}
                      {r.amount ? ` · ${formatCurrency(r.amount)}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
