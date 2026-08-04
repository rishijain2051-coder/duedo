"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api, type FamilyFlags } from "@/services/api";

/**
 * What the household has opted into. Head only.
 *
 * The defaults are the substance of this component, not the switches. Everyone always sees
 * their own figures and the shared timeline; what is off until somebody asks for it is the
 * part that turns a family into a league table — ordering members against each other,
 * streak badges, and one person being able to make another's phone buzz on purpose.
 *
 * The monthly mail is the exception and is on. It goes to the head alone, which is a
 * different thing from ranking everyone in public — and it carries only what is switched
 * on, so by default it is completion counts with no ordering and no streaks. Otherwise the
 * one message that arrives unasked would be the one containing what you chose to hide.
 */
const SWITCHES: { key: keyof FamilyFlags; label: string; hint: string }[] = [
  {
    key: "showRanking",
    label: "Order members by score",
    hint: "Off: everyone sees their own numbers, in joining order.",
  },
  {
    key: "showStreaks",
    label: "Streaks",
    hint: "Consecutive weeks and months with nothing missed.",
  },
  {
    key: "allowNudges",
    label: "Let members nudge each other",
    hint: "Sends a notification about something overdue. Once every 6 hours, and never before it's late.",
  },
  {
    key: "monthlyReportToHead",
    label: "Monthly summary to the head",
    hint: "Contains only what's switched on above.",
  },
];

export function FamilyPreferences({
  familyId,
  initial,
  onNotice,
  onError,
}: {
  familyId: string;
  initial: Partial<FamilyFlags>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [flags, setFlags] = useState<Partial<FamilyFlags>>(initial);
  const [busy, setBusy] = useState<string | null>(null);

  // The scoreboard response is the source of truth for two of these, and it is fetched
  // by a sibling — so mirror whatever the parent hands down when it changes.
  useEffect(() => setFlags(initial), [initial]);

  async function toggle(key: keyof FamilyFlags) {
    const next = !flags[key];
    setBusy(key);
    // Optimistic, then corrected on failure. A switch that waits for a round trip before
    // moving feels broken on a phone.
    setFlags((f) => ({ ...f, [key]: next }));
    try {
      await api.family.setFlags(familyId, { [key]: next });
      onNotice("Saved.");
    } catch (e) {
      setFlags((f) => ({ ...f, [key]: !next }));
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <p className="text-sm font-medium">What this family shows</p>
      {SWITCHES.map((s) => (
        <label
          key={s.key}
          className="flex cursor-pointer items-start justify-between gap-4"
        >
          <span className="min-w-0">
            <span className="block text-sm">{s.label}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{s.hint}</span>
          </span>
          <span className="relative mt-0.5 inline-flex shrink-0">
            {busy === s.key && (
              <Loader2 className="absolute -left-6 top-1 h-4 w-4 animate-spin text-muted-foreground" />
            )}
            <input
              type="checkbox"
              className="peer sr-only"
              checked={flags[s.key] === true}
              disabled={busy !== null}
              onChange={() => void toggle(s.key)}
            />
            <span
              aria-hidden
              className="h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-disabled:opacity-50"
            />
            <span
              aria-hidden
              className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"
            />
          </span>
        </label>
      ))}
    </div>
  );
}
