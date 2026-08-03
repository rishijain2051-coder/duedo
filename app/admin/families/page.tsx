"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useApp } from "@/components/app-context";
import { api, type AdminFamily } from "@/services/api";
import { formatDateTime } from "@/lib/format";

export default function AdminFamiliesPage() {
  const { timeZone } = useApp();
  const [families, setFamilies] = useState<AdminFamily[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFamilies(await api.admin.families());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 px-4 py-2 text-sm text-green-700 dark:text-green-400">
          {notice}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        You can administer a family you aren&apos;t in — that&apos;s the point of this
        page. Dissolving is refused while any reminder is still on the shared list, so
        it can never destroy someone&apos;s work as a side effect.
      </p>

      {loading ? (
        <div className="flex items-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : families.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No families yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {families.map((f) => (
            <div key={f.id} className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{f.name}</p>
                  <p className="text-xs text-muted-foreground">
                    code <span className="font-mono">{f.joinCode}</span> ·{" "}
                    {f.members.length} member{f.members.length === 1 ? "" : "s"} ·{" "}
                    {f.reminderCount} reminder{f.reminderCount === 1 ? "" : "s"} · since{" "}
                    {formatDateTime(f.createdAt, false, timeZone)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => {
                      const name = prompt("New name for this family", f.name);
                      if (!name || name.trim().length < 2) return;
                      void run(`rename-${f.id}`, async () => {
                        await api.admin.renameFamily(f.id, name.trim());
                        return "Family renamed.";
                      });
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Dissolve family"
                    className="text-destructive hover:bg-destructive/10"
                    disabled={busy !== null}
                    onClick={() => {
                      if (!confirm(`Dissolve ${f.name}? Every member loses the shared list.`))
                        return;
                      void run(`dissolve-${f.id}`, async () => {
                        await api.admin.dissolveFamily(f.id);
                        return `${f.name} dissolved.`;
                      });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <ul className="divide-y divide-border rounded-md border">
                {f.members.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {m.name}
                        {m.role === "head" && (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                            head
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {m.role !== "head" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() =>
                            run(`head-${m.id}`, async () => {
                              await api.admin.setFamilyHead(f.id, m.id);
                              return `${m.name} is now the head of ${f.name}.`;
                            })
                          }
                        >
                          Make head
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Remove from family"
                        className="text-destructive hover:bg-destructive/10"
                        disabled={busy !== null}
                        onClick={() => {
                          if (!confirm(`Remove ${m.name} from ${f.name}?`)) return;
                          void run(`remove-${m.id}`, async () => {
                            await api.admin.removeFamilyMember(f.id, m.id);
                            return `${m.name} removed from ${f.name}.`;
                          });
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
