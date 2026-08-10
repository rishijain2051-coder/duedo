/**
 * The two localStorage keys the theme is stored under.
 *
 * Their own module, with no `"use client"` and no imports, for one reason: the
 * blocking script in app/layout.tsx that applies the theme before first paint has to
 * interpolate them, and that runs on the **server**.
 *
 * Importing them from lib/theme.ts does not work, and fails in a way worth recording
 * because nothing catches it. That file is a client module, so a server import gets a
 * client-reference stub rather than a string, and templating the stub into the script
 * produced this:
 *
 *   localStorage.getItem('function() { throw new Error("Attempted to call
 *   THEME_MODE_KEY() from the server but THEME_MODE_KEY is on the client…
 *
 * — an unterminated string, so the whole bootstrap threw, its catch fell back to dark,
 * and the accent was never applied. No build error, no type error, no failed test: the
 * app simply ignored the theme picker.
 *
 * Splitting the constants out is what makes one definition genuinely usable from both
 * sides. lib/theme.ts re-exports them, so nothing else needs to know this file exists.
 */
export const THEME_MODE_KEY = "duedo:theme-mode";
export const THEME_ACCENT_KEY = "duedo:theme-accent";
