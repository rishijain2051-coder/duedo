"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { useApp } from "@/components/app-context";
import { api, type AuditEntry } from "@/services/api";
import { formatDateTime } from "@/lib/format";

/** Prefixes, so one option covers a whole family of actions. */
const FILTERS = [
  { value: "", label: "Everything" },
  { value: "user.", label: "Accounts" },
  { value: "family.", label: "Families" },
  { value: "admin.", label: "Admin access" },
];

/**
 * `detail` as prose rather than raw JSON.
 *
 * Braces, quotes and key names were most of the width of every row, so the one thing
 * worth reading — which account, which family — was the part squeezed out. Ids are
 * dropped: the row already names the entity, and a uuid tells a person nothing.
 */
function summarise(detail: unknown): string {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return "";
  return Object.entries(detail as Record<string, unknown>)
    .filter(([k, v]) => v !== null && v !== "" && !/id$/i.test(k))
    .map(([k, v]) => (typeof v === "boolean" ? (v ? k : `not ${k}`) : String(v)))
    .join(" · ");
}

export default function AdminAuditPage() {
  const { timeZone } = useApp();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.admin.audit({ action: action || undefined, take: 3 }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [action]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      <Select
        value={action}
        onChange={(e) => setAction(e.target.value)}
        className="max-w-52"
      >
        {FILTERS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </Select>

      {loading ? (
        <div className="flex items-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nothing recorded yet.
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y divide-border rounded-md border">
          {rows.map((r) => (
            <li key={r.id} className="px-3 py-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-mono text-xs">{r.action}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(r.timestamp, true, timeZone)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {r.actor?.name ?? "system"} · {r.entity}
                {summarise(r.detail) && ` · ${summarise(r.detail)}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
