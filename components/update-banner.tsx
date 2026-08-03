"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkForUpdate, applyUpdate } from "@/lib/update";

/**
 * Surfaces a new deployment. An installed PWA can keep running an old bundle for
 * a long time — it has no address bar and no obvious reason to reload — so a
 * passive check on load and on foreground is the only way anyone finds out.
 */
export function UpdateBanner() {
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    const res = await checkForUpdate();
    setStale(res.updateAvailable);
  }, []);

  useEffect(() => {
    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    // Also poll occasionally for a long-lived session left open.
    const timer = setInterval(() => void check(), 30 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [check]);

  if (!stale) return null;

  return (
    <div className="mx-4 mt-3 rounded-lg border border-primary/40 bg-primary/10 p-3 md:mx-8 md:mt-4">
      <div className="flex items-center gap-3">
        <RefreshCw className="h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">A new version is available</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Reload to pick up the latest changes.
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await applyUpdate();
          }}
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Reload
        </Button>
      </div>
    </div>
  );
}
