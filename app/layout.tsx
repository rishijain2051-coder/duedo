import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppFrame } from "@/components/app-frame";
import { ThemeApplier } from "@/components/theme-applier";

export const metadata: Metadata = {
  title: "PRO-SYS — Reminders",
  description: "Never miss a bill, birthday, renewal, or anything else that's due.",
  manifest: "/manifest.json",
  applicationName: "PRO-SYS",
  appleWebApp: {
    // iOS reads these from the HTML, not the manifest — without them "Add to
    // Home Screen" produces a plain Safari shortcut rather than a standalone
    // app, and push never works.
    capable: true,
    title: "PRO-SYS",
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
 */
const THEME_BOOTSTRAP = `
(function(){try{
  var m = localStorage.getItem('prosys:theme-mode') || 'dark';
  var a = localStorage.getItem('prosys:theme-accent') || 'blue';
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
      {/* The horizontal insets are here rather than on each page: with
          viewportFit=cover a notched phone held sideways puts ~47px of unusable
          screen down one edge, and padding the shell once covers the header, the
          sidebar and every page at the same time. Overlays are `fixed`, so they
          escape this and carry their own — see Modal and MobileNav. */}
      <body className="flex h-app-shell overflow-hidden bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] text-foreground">
        <ThemeApplier />
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
