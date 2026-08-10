"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/components/app-context";
import {
  enablePush,
  pushBlocker,
  isIos,
  type PushBlocker,
} from "@/lib/push-client";

// Surfaces notification setup where people will actually see it, instead of
// leaving it buried in Settings.
//
// Browsers only allow Notification.requestPermission() from a user gesture, so
// this can't self-enable — but it can be one tap instead of a hunt through menus.

const DISMISS_KEY = "duedo:push-prompt-dismissed";
const DISMISS_DAYS = 3;

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function PushPrompt() {
  const { settings, refreshSettings } = useApp();
  const [blocker, setBlocker] = useState<PushBlocker | null>(null);
  const [dismissed, setDismissed] = useState(true); // assume hidden until checked
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    // pushBlocker() also performs the silent re-register when permission is
    // already granted, so simply landing on a page repairs a lost subscription.
    setBlocker(await pushBlocker());
  }, []);

  useEffect(() => {
    setDismissed(recentlyDismissed());
    void check();
  }, [check]);

  // Re-check when the app comes back to the foreground: this is when someone has
  // typically just installed it or changed a permission in their OS settings.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [check]);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode — it'll just show again */
    }
    setDismissed(true);
  }

  async function turnOn() {
    setBusy(true);
    setError(null);
    const res = await enablePush();
    if (!res.ok) setError(res.reason ?? "Could not turn on notifications.");
    await check();
    await refreshSettings();
    setBusy(false);
  }

  // Nothing to say when notifications work, or when the device can't do them.
  if (blocker === null || blocker === "none" || blocker === "unsupported") return null;
  // Nor when this account has deliberately turned push off in Settings —
  // otherwise the app would nag people to enable a channel they just declined.
  if (settings && !settings.pushOptIn) return null;
  // "blocked" and "install" are dismissible; a missing permission is the whole
  // point of the app, so that one keeps asking.
  if (dismissed && blocker !== "permission") return null;

  const tone =
    blocker === "blocked"
      ? "border-destructive/40 bg-destructive/10"
      : "border-amber-500/40 bg-amber-500/10";

  return (
    <div className={`mx-4 mt-3 rounded-lg border p-3 md:mx-8 md:mt-4 ${tone}`}>
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          {blocker === "permission" && (
            <>
              <p className="text-sm font-medium">Turn on notifications</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Reminders can only reach your lock screen once you allow them.
              </p>
            </>
          )}

          {blocker === "install" && (
            <>
              <p className="text-sm font-medium">Add DueDo to your Home Screen</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isIos() ? (
                  <>
                    iPhone only delivers notifications to an installed app. Tap{" "}
                    <Share className="inline h-3 w-3 align-text-bottom" /> Share →{" "}
                    <strong>Add to Home Screen</strong>, then open DueDo from the
                    new icon.
                  </>
                ) : (
                  "Install the app from your browser menu to receive notifications."
                )}
              </p>
            </>
          )}

          {blocker === "blocked" && (
            <>
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                Notifications are blocked
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Nothing can reach you until you allow them in{" "}
                {isIos()
                  ? "Settings → Notifications → DueDo"
                  : "your browser's site settings"}
                . Email reminders still work if they&apos;re on.
              </p>
            </>
          )}

          {error && <p className="mt-1 text-xs text-red-700 dark:text-red-400">{error}</p>}

          {blocker === "permission" && (
            <Button size="sm" className="mt-2" onClick={turnOn} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Allow notifications
            </Button>
          )}
        </div>

        {blocker !== "permission" && (
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
