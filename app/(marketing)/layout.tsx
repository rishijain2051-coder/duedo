import type { Metadata, Viewport } from "next";
import { FONT_VARS } from "../fonts";
import "./landing.css";

/**
 * The landing page's own root layout.
 *
 * A second root layout rather than a route inside the app's one, and the reason is
 * structural rather than stylistic. The landing carries ~75 KB of motion library and
 * four font families that no signed-in screen has any use for, and the marketing
 * stylesheet owns `body`, `*`, `::selection` and the scrollbar — rules that would
 * otherwise land on every authenticated page too. Route groups give it a separate
 * document, so none of that is a matter of being careful: the app cannot load it and
 * this cannot load Tailwind.
 *
 * The cost is that moving between the two groups is a full page load rather than a
 * client transition. That is the correct trade here — /login is a destination someone
 * reaches once, not a tab they flick between.
 *
 * Note what is deliberately absent: the theme bootstrap script. The app lets you pick
 * a mode and an accent; this page is dark and blue for everybody, because a signed-out
 * visitor has no stored preference and a marketing page that renders four different
 * ways is four designs nobody signed off.
 */

/**
 * `metadataBase` is the setting that earns its place here: it makes `openGraph.images`
 * and `canonical` absolute. Most scrapers drop a relative og:image rather than
 * resolving it, and a share card that silently doesn't render is the failure nobody
 * notices until the link is already sent.
 *
 * The card is a static JPEG, not `next/og`. Measured on this exact image: 845 KB as a
 * generated PNG against 116 KB here — the difference between WhatsApp fetching the
 * preview and quietly not bothering. A static file also cannot fail at request time.
 * Regenerate it with tools/og.html in the marketing-site repo; it needs no toolchain.
 */
const DESCRIPTION =
  "A reminder app that keeps going after the notification. Advance alerts, a shared household list, and escalation to someone else when nobody answers.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://duedo.vercel.app"),
  // `default` for the landing itself, `template` for everything under it — so
  // /privacy is "Privacy Policy · DueDo" and never a bare "Privacy Policy", which is
  // what a search result would otherwise show with nothing to say whose it is.
  title: {
    default: "DueDo · never miss a bill, a birthday, or a renewal",
    template: "%s · DueDo",
  },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "DueDo",
    locale: "en_IN",
    url: "/",
    title: "DueDo · never miss a bill, a birthday, or a renewal",
    description: DESCRIPTION,
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "The DueDo mark above the line: Everything you owe, before it owes you.",
      },
    ],
  },
  // X falls back to the openGraph strings, so only the card type is declared.
  // Repeating the three above under twitter:* would just give them somewhere to drift.
  twitter: { card: "summary_large_image" },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#06060a",
  width: "device-width",
  initialScale: 1,
};

/**
 * Hides the animated-in elements before the browser paints.
 *
 * Without this you see them, then see JS hide them, then see them animate back in.
 * Doing the hiding in plain CSS instead would strand the page blank whenever the
 * motion layer never arrives — so it is gated on a class that removes itself after
 * three seconds if nothing claims it. No JavaScript at all means no class, which means
 * nothing is ever hidden and the page simply reads as a static document.
 */
const ANIM_GATE = `
(function(){var r=document.documentElement;r.classList.add("anim");
window.__ddAnimFailsafe=setTimeout(function(){r.classList.remove("anim")},3000);})();
`;

export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning for the same reason app/(app)/layout.tsx carries it:
    // the script below deliberately adds a class to this element before React
    // hydrates, so the server HTML and the live DOM are *meant* to differ here. It
    // suppresses the warning for this element's own attributes only — a genuine
    // mismatch anywhere inside still reports.
    <html lang="en" suppressHydrationWarning className={FONT_VARS}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: ANIM_GATE }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
