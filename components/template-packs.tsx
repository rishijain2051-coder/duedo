"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, PackageOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useApp } from "@/components/app-context";
import { api, type PackItemView, type TemplatePacks } from "@/services/api";
import { formatDateTime } from "@/lib/format";
import { formatINR } from "@/lib/money";

/**
 * Starter packs, with a preview.
 *
 * The preview is the feature, not a formality. Importing twelve reminders on one tap and
 * showing the result is indistinguishable from a bug — the list suddenly has things in it
 * the user didn't type. A checklist with the dates and amounts already resolved, which
 * they can untick, is the same import without the surprise.
 */
export function TemplatePacksCard({
  onNotice,
  onError,
  onImported,
}: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onImported?: () => void;
}) {
  const { scope, families, timeZone } = useApp();
  const [data, setData] = useState<TemplatePacks | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.templates.list(scope));
    } catch (e) {
      onError((e as Error).message);
    }
    // onError deliberately omitted: it's an inline arrow in every caller, so including it
    // would re-run this on every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const pack = data?.packs.find((p) => p.id === open) ?? null;
  const scopeName =
    scope === "mine" ? "your own list" : (families.find((f) => f.id === scope)?.name ?? "the family list");

  function start(id: string) {
    const p = data?.packs.find((x) => x.id === id);
    if (!p) return;
    // Everything not already there starts ticked. Someone opening a pack wants the pack;
    // unticking is the exception.
    setChosen(new Set(p.items.filter((i) => !i.alreadyImported).map((i) => i.key)));
    setOpen(id);
  }

  async function confirm() {
    if (!pack) return;
    setBusy(true);
    try {
      const res = await api.templates.import(pack.id, scope, [...chosen]);
      setOpen(null);
      onNotice(
        `Added ${res.created} reminder${res.created === 1 ? "" : "s"}` +
          (res.categoriesCreated > 0
            ? ` and ${res.categoriesCreated} categor${res.categoriesCreated === 1 ? "y" : "ies"}`
            : "") +
          (res.skipped > 0 ? `. ${res.skipped} were already there.` : "."),
      );
      await load();
      onImported?.();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageOpen className="h-5 w-5" /> Starter packs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Adding to {scopeName}. You choose what goes in.
          </p>
          <ul className="divide-y divide-border rounded-md border">
            {data.packs.map((p) => {
              const left = p.items.filter((i) => !i.alreadyImported).length;
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.blurb}</p>
                  </div>
                  {left === 0 ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-green-600 dark:text-green-400">
                      <Check className="h-3.5 w-3.5" /> all added
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => start(p.id)}>
                      Review {left}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Modal open={!!pack} onClose={() => setOpen(null)} title={pack?.name ?? ""}>
        {pack && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {chosen.size} of {pack.items.length} selected. Dates and amounts are starting
              points — edit any of them afterwards.
            </p>
            <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border">
              {pack.items.map((item) => (
                <Row
                  key={item.key}
                  item={item}
                  timeZone={timeZone}
                  checked={chosen.has(item.key)}
                  onToggle={() =>
                    setChosen((prev) => {
                      const next = new Set(prev);
                      if (next.has(item.key)) next.delete(item.key);
                      else next.add(item.key);
                      return next;
                    })
                  }
                />
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(null)}>
                Cancel
              </Button>
              <Button disabled={busy || chosen.size === 0} onClick={confirm}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add {chosen.size}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function Row({
  item,
  checked,
  onToggle,
  timeZone,
}: {
  item: PackItemView;
  checked: boolean;
  onToggle: () => void;
  timeZone: string | undefined;
}) {
  return (
    <li className={item.alreadyImported ? "opacity-50" : ""}>
      <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--primary)]"
          checked={checked}
          disabled={item.alreadyImported}
          onChange={onToggle}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{item.title}</span>
            {item.amount > 0 && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatINR(item.amount)}
              </span>
            )}
            {item.alreadyImported && (
              <span className="text-xs text-green-600 dark:text-green-400">already added</span>
            )}
          </span>
          <span className="block text-xs text-muted-foreground">
            {item.category} · {item.recurrence} ·{" "}
            {item.datePlaceholder ? (
              // Said plainly rather than left to be discovered. A pack cannot know when
              // somebody's birthday is, and a silently wrong date is worse than an
              // obviously provisional one.
              <span className="text-amber-600 dark:text-amber-400">
                set the date after adding
              </span>
            ) : (
              formatDateTime(item.dueAt, false, timeZone)
            )}
          </span>
          {item.note && (
            <span className="mt-0.5 block text-xs text-muted-foreground">{item.note}</span>
          )}
        </span>
      </label>
    </li>
  );
}
