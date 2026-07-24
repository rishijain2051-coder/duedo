import type { Reminder } from "@/types";

export function formatCurrency(amount?: number | null): string {
  if (!amount) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function toDateInputValue(value?: string | Date | null): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  // yyyy-mm-dd for <input type="date">
  return d.toISOString().slice(0, 10);
}

/** Whole days from today (UTC-ish, local midnight) until the due date. */
export function daysUntil(due: string | Date): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const d = typeof due === "string" ? new Date(due) : new Date(due);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - start.getTime()) / 86_400_000);
}

export interface ReminderStatus {
  label: string;
  tone: "overdue" | "today" | "soon" | "upcoming" | "done";
  className: string;
}

export function reminderStatus(r: Reminder): ReminderStatus {
  if (r.status === "completed")
    return { label: "Completed", tone: "done", className: "text-green-500" };
  if (r.status === "archived")
    return { label: "Archived", tone: "done", className: "text-muted-foreground" };

  const days = daysUntil(r.dueDate);
  if (days < 0)
    return {
      label: `Overdue ${Math.abs(days)}d`,
      tone: "overdue",
      className: "text-red-500",
    };
  if (days === 0)
    return { label: "Due today", tone: "today", className: "text-orange-500" };
  if (days === 1)
    return { label: "Due tomorrow", tone: "soon", className: "text-orange-400" };
  if (days <= 7)
    return { label: `In ${days} days`, tone: "soon", className: "text-yellow-500" };
  return { label: `In ${days} days`, tone: "upcoming", className: "text-blue-400" };
}
