"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useApp } from "@/components/app-context";
import { useCached } from "@/lib/cache";
import { api } from "@/services/api";
import { formatTime, toDateKey } from "@/lib/format";
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
  const reminders = data ?? NO_REMINDERS;
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

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
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl md:text-3xl font-bold tracking-tight">Calendar</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCursor(new Date(year, month - 1, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-36 md:w-40 text-center text-base md:text-lg font-semibold">
            {MONTHS[month]} {year}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCursor(new Date(year, month + 1, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="default" size="sm" onClick={goToday}>
            Today
          </Button>
        </div>
      </div>

      <Card>
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
            <div className="grid grid-cols-7 auto-rows-[70px] sm:auto-rows-[90px] md:auto-rows-[110px] divide-x divide-y divide-border">
              {cells.map((day, i) => {
                if (day === null) return <div key={i} className="bg-muted/10" />;
                const key = cellKey(year, month, day);
                const items = byDay.get(key) ?? [];
                const isToday = key === todayKey;
                return (
                  <div
                    key={i}
                    className="space-y-1 overflow-hidden p-1.5 transition-colors hover:bg-muted/30"
                  >
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-sm ${
                        isToday ? "bg-primary font-bold text-primary-foreground" : ""
                      }`}
                    >
                      {day}
                    </span>
                    {items.slice(0, 2).map((r) => {
                      const color = r.category?.color ?? "#64748b";
                      return (
                        <div
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
                        </div>
                      );
                    })}
                    {items.length > 2 && (
                      <div className="px-1 text-[10px] md:text-xs text-muted-foreground">
                        +{items.length - 2} more
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
