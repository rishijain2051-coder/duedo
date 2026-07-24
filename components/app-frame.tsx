"use client";

import { usePathname } from "next/navigation";
import { MemberProvider } from "@/components/member-context";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";

/**
 * The login page renders bare (no sidebar/header/auth provider). Every other page
 * is wrapped in the authenticated app chrome.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <MemberProvider>
      <Sidebar />
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <Header />
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </MemberProvider>
  );
}
