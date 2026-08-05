"use client";

import { CloudOff } from "lucide-react";
import { useOffline } from "@/lib/net";

/**
 * Says so when the app is running on stored data.
 *
 * One line for the whole app rather than an error on each page. Without it the
 * offline state is invisible in the worst way: the pages still paint, the figures
 * still look current, and the only clue that nothing has been re-read is that a tap
 * on Complete quietly fails.
 */
export function OfflineBar() {
  const offline = useOffline();
  if (!offline) return null;

  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 md:mx-8 md:mt-4">
      <CloudOff className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500" />
      <div className="min-w-0">
        <p className="text-sm font-medium">You&apos;re offline</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Showing the last copy saved on this device.
        </p>
      </div>
    </div>
  );
}
