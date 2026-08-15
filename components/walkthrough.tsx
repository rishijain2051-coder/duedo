"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useApp } from "@/components/app-context";
import { api } from "@/services/api";
import { planSpec } from "@/lib/plan";
import { stepsFor } from "@/lib/walkthrough";

/**
 * The walkthrough a new account gets on its first authenticated load.
 *
 * A stepped dialog rather than spotlights cut out of the real UI. The two navigations
 * here are not the same shape — on a laptop the nav is a sidebar, on a phone it is a
 * drawer behind a button — so anything anchored to those elements has to be authored
 * twice and then keeps working right up until a class name changes, at which point it
 * points at the wrong corner of the screen with nothing to say it is wrong. A dialog
 * says the same thing on both, and cannot drift out of alignment with a layout.
 *
 * Skip is a real answer, on every step, and it counts the same as finishing: a first
 * run that will not take no for an answer is worse than no first run. What makes that
 * cheap is the replay control in Settings — nothing here is only offered once.
 *
 * The copy and the step filter live in lib/walkthrough.ts so a suite can run them.
 */

/**
 * Mirrors tourSeenAt locally, and it is not redundant.
 *
 * Two things would otherwise re-open a dialog somebody has already answered. The
 * PATCH can fail — offline, or a dropped connection at exactly the moment they pressed
 * Skip — and the shell paints from a bootstrap payload cached for up to a day, which
 * on the next load still says the tour has never been seen. Either way the fix is the
 * same: remember the answer on the device that gave it. The server value stays the
 * one that matters, because it is the one that crosses to the next device.
 */
const SEEN_KEY = "duedo:walkthrough-seen";

function mirrored(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    // Private mode. It shows once more, which is the harmless way to be wrong.
    return false;
  }
}

/** Cleared by the replay control in Settings, so the local answer stops overriding. */
export function forgetWalkthrough() {
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {
    /* nothing to forget */
  }
}

export function Walkthrough() {
  const { user, settings } = useApp();
  // Assume hidden until the settings say otherwise — the same idiom as PushPrompt,
  // and it is what stops the dialog flashing over a shell that is still loading.
  const [dismissed, setDismissed] = useState(true);
  const [step, setStep] = useState(0);

  const seenAt = settings?.tourSeenAt ?? null;
  const ready = settings !== null;

  /**
   * Depends on the timestamp, not on the settings object.
   *
   * `settings` is replaced wholesale whenever anything refreshes it — turning on push
   * does — and resetting to step 0 halfway through the tour because of an unrelated
   * save would look like the app losing its place.
   */
  useEffect(() => {
    if (!ready) return;
    if (seenAt) {
      setDismissed(true);
      return;
    }
    setDismissed(mirrored());
    setStep(0);
  }, [ready, seenAt]);

  const plan = planSpec(settings?.plan);
  const steps = useMemo(
    () =>
      stepsFor({
        name: user?.name ?? settings?.name ?? "",
        accountType: settings?.accountType ?? "solo",
        email: plan.limits.email,
        spending: plan.limits.spending,
        voice: plan.limits.voice,
        free: plan.id === "free",
        overdueRepeatMins: settings?.overdueRepeatMins ?? 60,
      }),
    [
      user?.name,
      settings?.name,
      settings?.accountType,
      settings?.overdueRepeatMins,
      plan,
    ],
  );

  const open = ready && !dismissed;
  const last = step >= steps.length - 1;

  /** Finishing and skipping record the same thing, because they mean the same thing. */
  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* the server copy below is the one that matters */
    }
    // Not awaited, and no refresh afterwards: the dialog is already closed, the local
    // mirror already covers the next load, and a spinner on "Skip" would be asking
    // someone to wait for the privilege of leaving.
    void api.settings.update({ tourSeen: true }).catch(() => {
      /* it will be re-sent as a fresh tour next time this account signs in elsewhere */
    });
  }

  // Arrow keys, because a stepped dialog on a desktop should answer to them. Escape
  // is handled by Modal, and lands on onClose — which is dismiss, same as Skip.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Clamped rather than wrapping, and the last step deliberately does not finish
      // on ArrowRight: leaning on an arrow key must not be able to close this.
      if (e.key === "ArrowRight") setStep((n) => Math.min(n + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setStep((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, steps.length]);

  if (!open) return null;
  const current = steps[step];

  return (
    <Modal open onClose={dismiss} title={current.title}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          {/* aria-hidden: the count beside it already says this, and eight unlabelled
              dots read aloud are noise. */}
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {steps.map((s, n) => (
              <span
                key={s.id}
                className={
                  n === step
                    ? "h-1.5 w-5 rounded-full bg-primary transition-all"
                    : n < step
                      ? "h-1.5 w-1.5 rounded-full bg-primary/40 transition-all"
                      : "h-1.5 w-1.5 rounded-full bg-border transition-all"
                }
              />
            ))}
          </div>
          <p className="text-xs tabular-nums text-muted-foreground">
            Step {step + 1} of {steps.length}
          </p>
        </div>

        {current.body.map((paragraph) => (
          <p key={paragraph} className="text-sm leading-relaxed text-muted-foreground">
            {paragraph}
          </p>
        ))}

        {current.points && (
          <ul className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
            {current.points.map((point) => (
              <li key={point.name} className="text-sm leading-relaxed">
                <span className="font-medium text-foreground">{point.name}</span>
                <span className="text-muted-foreground"> — {point.what}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          {/* Left, away from Next, and there on every step including the last one.
              44px on a phone like every other target in the app — this is the control
              somebody who does not want a tour is reaching for, and it was the one
              button here small enough to miss. */}
          <button
            type="button"
            onClick={dismiss}
            className="min-h-11 rounded-md px-3 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline sm:min-h-9"
          >
            {last ? "Close" : "Skip"}
          </button>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button variant="outline" onClick={() => setStep((n) => n - 1)}>
                Back
              </Button>
            )}
            {last && current.link ? (
              // The end of the tour is the one place a link belongs: there is nothing
              // after it to interrupt. Marks the tour seen on the way out.
              <Link href={current.link.href} onClick={dismiss}>
                <Button>{current.link.label}</Button>
              </Link>
            ) : (
              <Button onClick={() => (last ? dismiss() : setStep((n) => n + 1))}>
                {last ? "Done" : "Next"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
