import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppFrame } from "@/components/app-frame";
import { ThemeApplier } from "@/components/theme-applier";
// lib/theme-keys.ts, not lib/theme.ts: this file renders on the server and that one is
// a client module, so importing from it yields a stub rather than the string.
import { THEME_ACCENT_KEY, THEME_MODE_KEY } from "@/lib/theme-keys";

export const metadata: Metadata = {
  title: "DueDo — Just missed it? Never again.",
  description: "Bills, birthdays, renewals — sorted.",
  manifest: "/manifest.json",
  applicationName: "DueDo",
  appleWebApp: {
    // iOS reads these from the HTML, not the manifest — without them "Add to
    // Home Screen" produces a plain Safari shortcut rather than a standalone
    // app, and push never works.
    capable: true,
    // Sits under the Home Screen icon, where there is room for about twelve
    // characters — the name alone, never the tagline.
    title: "DueDo",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
  width: "device-width",
  initialScale: 1,
  // Keeps the layout clear of the iPhone notch and home indicator.
  viewportFit: "cover",
  // Pinch-zoom is deliberately left enabled: inputs are 16px on phones, which is
  // what stops iOS zooming on focus, so there's no reason to take zoom away.
};

/**
 * Applies the stored theme before the first paint.
 *
 * This has to be a blocking inline script: doing it in an effect means the page
 * renders once with the default palette and then visibly snaps to the chosen one.
 * Defaults to dark, matching what the app shipped with.
 *
 * The two key names are interpolated from lib/theme.ts rather than typed out again.
 * They were typed out again until the DueDo rename, and that is exactly the shape of
 * bug worth removing: renaming the constants there would have left this script reading
 * keys nobody writes any more, so every load would silently reset to dark/blue and the
 * theme picker would look broken with nothing in it actually wrong.
 */
const THEME_BOOTSTRAP = `
(function(){try{
  var m = localStorage.getItem('${THEME_MODE_KEY}') || 'dark';
  var a = localStorage.getItem('${THEME_ACCENT_KEY}') || 'blue';
  var dark = m === 'dark' || (m === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var r = document.documentElement;
  if (dark) r.classList.add('dark'); else r.classList.remove('dark');
  r.setAttribute('data-accent', a);
}catch(e){document.documentElement.classList.add('dark');}})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      {/* Deliberately plain. The one-viewport flex shell that the app runs inside used
          to live here, which was fine while every route was the app — it now sits on a
          wrapper in AppFrame instead, because the root is a landing page that needs the
          document itself to scroll. `overflow-hidden` on body would have stopped it
          dead, and scroll-driven motion and `position: sticky` both need a scrolling
          document rather than a scrolling div. */}
      <body className="bg-background text-foreground">
        <ThemeApplier />
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
