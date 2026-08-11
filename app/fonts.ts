import {
  Bricolage_Grotesque,
  Schibsted_Grotesk,
  Newsreader,
  JetBrains_Mono,
} from "next/font/google";

/**
 * The public faces, in one module because two root-level files need them.
 *
 * app/(marketing)/layout.tsx renders every public page, and app/not-found.tsx renders
 * its own <html> — an unmatched URL belongs to neither route group, so there is no
 * layout above it to inherit anything from. Declaring the loaders twice would work but
 * would give the two documents separate font instances and separate CSS variable names,
 * which is exactly the kind of difference nobody notices until a 404 renders in Times.
 *
 * The faces were chosen against a blocklist and should not casually go back: Inter,
 * Roboto, Geist, Instrument Sans, Plus Jakarta and Space Grotesk are all overused, and
 * Instrument Serif and Fraunces are the two default AI serifs.
 */

export const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "600", "800"],
  variable: "--font-display",
  display: "swap",
});

export const body = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

/** Italic only — it sets about six accent words on the whole site. */
export const serif = Newsreader({
  subsets: ["latin"],
  style: ["italic"],
  weight: ["300", "400"],
  variable: "--font-serif",
  display: "swap",
});

export const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-mono",
  display: "swap",
});

/** Every variable at once, for the <html> className. */
export const FONT_VARS = `${display.variable} ${body.variable} ${serif.variable} ${mono.variable}`;
