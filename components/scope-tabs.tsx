"use client";

import { useApp } from "@/components/app-context";

/**
 * Mine / <family> switcher.
 *
 * Lifted out of the reminders page so every scoped page shows the same control backed by
 * the same state. Two copies of this would be two places to forget that the selected
 * family can vanish underneath you.
 *
 * Renders nothing when there is no choice to make: a solo account, or a family account
 * that hasn't joined one yet, gets a row of one tab that does nothing — which is worse
 * than no row at all.
 */
export function ScopeTabs({ className = "" }: { className?: string }) {
  const { families, scope, setScope } = useApp();
  if (families.length === 0) return null;

  const tabs = [{ id: "mine", label: "Mine" }, ...families.map((f) => ({ id: f.id, label: f.name }))];

  return (
    <div className={`flex flex-wrap gap-2 pb-1 ${className}`}>
      {tabs.map((tab) => {
        const active = scope === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setScope(tab.id)}
            aria-current={active ? "true" : undefined}
            className={`flex min-h-11 shrink-0 items-center rounded-md border px-4 text-sm font-medium transition-colors md:min-h-0 md:py-1.5 ${
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
