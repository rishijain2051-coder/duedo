"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkForUpdate, compareBuild, applyUpdate } from "@/lib/update";
import { useApp } from "@/components/app-context";

/**
 * Surfaces a new deployment. An installed PWA can keep running an old bundle for
 * a long time — it has no address bar and no obvious reason to reload — so a
 * passive check on load and on foreground is the only way anyone finds out.
 */
export function UpdateBanner() {
  const { deployedBuildId } = useApp();
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);

  const lastCheck = useRef(0);
  const check = useCallback(async () => {
    // Same reasoning as the badge: this is on visibilitychange, which fires far more
    // often than a deployment happens. Five minutes is still far quicker than anyone
    // needs to hear about a new build.
    if (Date.now() - lastCheck.current < 5 * 60_000) return;
    lastCheck.current = Date.now();
    const res = await checkForUpdate();
    setStale(res.updateAvailable);
  }, []);

  // The first answer rides along with /api/bootstrap, which the shell fetches anyway.
  // Only the later re-checks — on foreground, and the half-hourly poll for a session
  // left open — need a request of their own.
  useEffect(() => {
    if (deployedBuildId) setStale(compareBuild(deployedBuildId).updateAvailable);
  }, [deployedBuildId]);

  useEffect(() => {
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
