"use client";

import { useEffect } from "react";
import { applyTheme, readAccent, readMode } from "@/lib/theme";

/**
 * Re-applies the stored theme once on mount.
 *
 * The inline script in layout.tsx sets the palette before first paint so there's
 * no flash — but React owns <html> and reverts attributes it didn't render during
 * hydration (suppressHydrationWarning silences the warning, it doesn't stop the
 * reconciliation). So the script wins the paint and this wins the hydration.
 *
 * Mounted outside the authenticated frame so the login screen is themed too.
 */
export function ThemeApplier() {
  useEffect(() => {
    applyTheme(readMode(), readAccent());
  }, []);
  return null;
}
