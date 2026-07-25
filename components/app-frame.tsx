"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { MemberProvider } from "@/components/member-context";
import { Sidebar, MobileNav } from "@/components/sidebar";
import { Header } from "@/components/header";

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <MemberProvider>
      <Sidebar />
      <MobileNav
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <Header onMenuToggle={() => setMobileNavOpen((o) => !o)} />
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </MemberProvider>
  );
}
