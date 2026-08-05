"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AppProvider } from "@/components/app-context";
import { Sidebar, MobileNav } from "@/components/sidebar";
import { Header } from "@/components/header";
import { PushPrompt } from "@/components/push-prompt";
import { UpdateBanner } from "@/components/update-banner";
import { OfflineBar } from "@/components/offline-bar";

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // The login page renders bare — it has no session yet, so it must not mount
  // AppProvider (which would bounce it straight back to /login).
  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <AppProvider>
      <Sidebar />
      <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      {/* h-full, not its own viewport height: body already is one viewport tall, and
          a second 100vh here would ignore the dvh correction body just made. */}
      <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <Header onMenuToggle={() => setMobileNavOpen((o) => !o)} />
        <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {/* Above the page content on every screen — notifications are the point
              of the app, so setting them up shouldn't require finding Settings. */}
          <OfflineBar />
          <UpdateBanner />
          <PushPrompt />
          {children}
        </div>
      </main>
    </AppProvider>
  );
}
