"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AppProvider } from "@/components/app-context";
import { Sidebar, MobileNav } from "@/components/sidebar";
import { Header } from "@/components/header";
import { PushPrompt } from "@/components/push-prompt";
import { UpdateBanner } from "@/components/update-banner";
import { PlanUpgraded } from "@/components/plan-upgraded";
import { OfflineBar } from "@/components/offline-bar";
import { OutboxBar } from "@/components/outbox-bar";
import { Walkthrough } from "@/components/walkthrough";
import { GuidedTourProvider } from "@/components/guided-tour";

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // The login page renders bare — it has no session yet, so it must not mount
  // AppProvider (which would bounce it straight back to /login).
  //
  // The landing page needs no case here at all: it lives under app/(marketing), which
  // has its own root layout and never renders this component.
  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <AppProvider>
      {/* Wraps the whole shell because the header's help button, the Settings card and
          the closing step of the intro dialog all start a tour, and they sit in three
          different corners of this tree. */}
      <GuidedTourProvider>
        {/* The app shell: exactly one viewport tall, with its own scroll container.
          This moved off <body> when the root became a landing page — body has to stay
          a normally scrolling document for that, and this is the only subtree that
          wants to be pinned to the viewport.

          The horizontal insets are here rather than on each page: with viewportFit=cover
          a notched phone held sideways puts ~47px of unusable screen down one edge, and
          padding the shell once covers the header, the sidebar and every page at the
          same time. Overlays are `fixed`, so they escape this and carry their own —
          see Modal and MobileNav. */}
        <div className="flex h-app-shell overflow-hidden pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
          <Sidebar />
          <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
          {/* h-full, not its own viewport height: the wrapper above already is one
            viewport tall, and a second 100vh here would ignore the dvh correction it
            just made. */}
          <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
            <Header onMenuToggle={() => setMobileNavOpen((o) => !o)} />
            <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
              {/* Above the page content on every screen — notifications are the point
                of the app, so setting them up shouldn't require finding Settings. */}
              <OfflineBar />
              <OutboxBar />
              <UpdateBanner />
              <PlanUpgraded />
              <PushPrompt />
              {children}
            </div>
          </main>
        </div>
        {/* Outside the shell rather than inside it, because it is a fixed overlay and
          not page content — nesting it in the scroll container would only suggest it
          scrolls. Renders nothing at all for an account that has already seen it. */}
        <Walkthrough />
      </GuidedTourProvider>
    </AppProvider>
  );
}
