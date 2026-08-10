"use client";

import { useEffect, useState } from "react";
import { PartyPopper, X } from "lucide-react";
import { useApp } from "@/components/app-context";
import { PLANS, isStaff, planSpec, type PlanId } from "@/lib/plan";

/**
 * Says so, once, when an account's plan goes up.
 *
 * A grant happens somewhere else entirely — the owner types a date into the admin
 * panel after money arrives over UPI — so the first the account hears of it is
 * whenever they next open the app. Without this, the only evidence is a paywall that
 * has quietly stopped appearing, which is a poor way to learn you got what you paid
 * for.
 *
 * "Changed since last time on this device" is the whole mechanism. There is no event
 * to subscribe to and nothing on the server saying whether this person has been told,
 * and adding a column for it would mean a write on every read to clear it. A key in
 * localStorage answers the same question for one device, which is the only place a
 * banner can be shown anyway.
 *
 * Consequences worth being honest about: a second device shows the notice again, and
 * a cleared browser shows it once more. Both are a duplicate congratulation, which is
 * the cheapest possible thing to get wrong here.
 */
const SEEN_KEY = "duedo:plan-seen";

/** Free is 0; the paid tiers ascend. Only an increase is worth interrupting for. */
const RANK: Record<PlanId, number> = { free: 0, individual: 1, family: 2 };

export function PlanUpgraded() {
  const { settings } = useApp();
  const [upgradedTo, setUpgradedTo] = useState<PlanId | null>(null);

  useEffect(() => {
    // Nothing to compare against until the shell has actually loaded settings.
    if (!settings) return;
    // Staff are on the top plan by role, not by a grant. Congratulating the owner on
    // being the owner, every time they clear their browser, is noise.
    if (isStaff(settings)) return;

    const now = planSpec(settings.plan).id;
    let previous: string | null = null;
    try {
      previous = localStorage.getItem(SEEN_KEY);
    } catch {
      // Private mode. Never seen anything, never records anything; the notice simply
      // doesn't fire, which is the right failure for something purely celebratory.
      return;
    }

    // First run on this device records where they are and says nothing. Otherwise
    // every existing paid account would be congratulated on the deploy that shipped
    // this file, which is a lie about what just happened.
    if (previous === null) {
      try {
        localStorage.setItem(SEEN_KEY, now);
      } catch {
        /* ignore */
      }
      return;
    }

    if (previous !== now) {
      try {
        localStorage.setItem(SEEN_KEY, now);
      } catch {
        /* ignore */
      }
      // Only upward. A lapse is already explained by the renewal warning that
      // preceded it, and "your plan ended" is not a thing to pop up in a party hat.
      const before = RANK[planSpec(previous).id] ?? 0;
      if (RANK[now] > before) setUpgradedTo(now);
    }
  }, [settings]);

  if (!upgradedTo) return null;

  const plan = PLANS[upgradedTo];

  return (
    <div className="mx-4 mt-3 rounded-lg border border-primary/40 bg-primary/10 p-3 md:mx-8 md:mt-4">
      <div className="flex items-center gap-3">
        <PartyPopper className="h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">You&apos;re on {plan.name} — thank you!</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Email reminders, the spending tracker and adding by voice are all unlocked
            {upgradedTo === "family" && ", and you can start a family of up to four"}.
          </p>
        </div>
        <button
          onClick={() => setUpgradedTo(null)}
          aria-label="Dismiss"
          className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
