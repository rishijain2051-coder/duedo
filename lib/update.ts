"use client";

import { api } from "@/services/api";

// Update detection for an installed PWA.
//
// The build id is baked into this bundle at build time (NEXT_PUBLIC_BUILD_ID),
// while /api/version reports the build that is deployed *now*. A running app
// therefore carries the id of the deployment that served it, and any difference
// means what's on screen is stale.

export const RUNNING_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "unknown";

export interface UpdateCheck {
  updateAvailable: boolean;
  running: string;
  deployed: string | null;
  error?: string;
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  try {
    const { buildId } = await api.version();
    return {
      // Never claim an update when either side is unknown — that would show the
      // banner forever on a build without an id.
      updateAvailable:
        buildId !== "unknown" &&
        RUNNING_BUILD_ID !== "unknown" &&
        buildId !== RUNNING_BUILD_ID,
      running: RUNNING_BUILD_ID,
      deployed: buildId,
    };
  } catch (e) {
    return {
      updateAvailable: false,
      running: RUNNING_BUILD_ID,
      deployed: null,
      error: (e as Error).message,
    };
  }
}

/**
 * Pulls the new build in. The service worker is refreshed first — otherwise an
 * installed PWA can keep being controlled by the old worker across the reload.
 */
export async function applyUpdate(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.update().catch(() => {});
        // A worker sitting in "waiting" only activates once told to.
        registration.waiting?.postMessage({ type: "SKIP_WAITING" });
      }
    }
  } catch {
    /* the reload below is what actually matters */
  }
  // Bypasses the HTTP cache, which reload() alone does not reliably do on iOS.
  window.location.href = `${window.location.pathname}?v=${Date.now()}`;
}
