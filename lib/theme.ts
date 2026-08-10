"use client";

import { ACCENTS, type AccentId, type ThemeMode } from "@/types";

// Theme is stored per device in localStorage rather than against the account, so
// it can be applied synchronously before first paint. A server round-trip would
// guarantee a flash of the wrong palette on every load — and since two people
// sharing a laptop each get their own browser profile in practice, per-device is
// also usually what they want.

// Defined in a non-client module so the server-rendered bootstrap in app/layout.tsx can
// interpolate them too, and re-exported here so callers still import them from one
// place. See lib/theme-keys.ts for what goes wrong otherwise.
//
// Imported *and* re-exported, not `export … from`: a bare re-export forwards the names
// without binding them locally, so readMode below would call getItem(undefined), get
// null, and silently return the default — the theme picker appearing to do nothing.
import { THEME_ACCENT_KEY, THEME_MODE_KEY } from "./theme-keys";
export { THEME_ACCENT_KEY, THEME_MODE_KEY };

export const DEFAULT_MODE: ThemeMode = "dark";
export const DEFAULT_ACCENT: AccentId = "blue";

const ACCENT_IDS = ACCENTS.map((a) => a.id) as readonly string[];

export function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_MODE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* private mode */
  }
  return DEFAULT_MODE;
}

export function readAccent(): AccentId {
  try {
    const v = localStorage.getItem(THEME_ACCENT_KEY);
    if (v && ACCENT_IDS.includes(v)) return v as AccentId;
  } catch {
    /* private mode */
  }
  return DEFAULT_ACCENT;
}

export function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Resolves "system" against the OS setting. */
export function effectiveDark(mode: ThemeMode): boolean {
  return mode === "dark" || (mode === "system" && prefersDark());
}

export function applyTheme(mode: ThemeMode, accent: AccentId): void {
  const root = document.documentElement;
  root.classList.toggle("dark", effectiveDark(mode));
  root.dataset.accent = accent;

  // Keep the iOS status bar / browser chrome in step with the palette.
  const meta = document.querySelector('meta[name="theme-color"]');
  const swatch = ACCENTS.find((a) => a.id === accent);
  if (meta && swatch) meta.setAttribute("content", swatch.primary);
}

export function saveMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_MODE_KEY, mode);
  } catch {
    /* private mode */
  }
}

export function saveAccent(accent: AccentId): void {
  try {
    localStorage.setItem(THEME_ACCENT_KEY, accent);
  } catch {
    /* private mode */
  }
}
