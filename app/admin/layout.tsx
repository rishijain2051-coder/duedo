"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { useApp } from "@/components/app-context";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/accounts", label: "Accounts" },
  { href: "/admin/families", label: "Families" },
  { href: "/admin/health", label: "Health" },
  { href: "/admin/audit", label: "Audit log" },
];

/**
 * Admin shell.
 *
 * The check here is presentation only — it stops a member seeing a broken page.
 * The real boundary is `jsonAdmin()` on every /api/admin route, because there is
 * no middleware and a client-side check is worth exactly nothing to anyone
 * willing to call the API directly.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isAdmin, loading, settings } = useApp();

  if (loading || !settings) {
    return <div className="p-4 text-muted-foreground md:p-8">Loading…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="flex-1 p-4 md:p-8">
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="text-sm font-medium">Admins only</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              This area manages every account on the install.{" "}
              <Link href="/" className="text-primary underline">
                Back to your reminders
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  const pending = settings.pendingApprovals ?? 0;

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8">
      <div>
        <h2 className="text-xl font-bold tracking-tight md:text-3xl">Admin</h2>
        <p className="text-xs text-muted-foreground md:text-sm">
          Every account, family and delivery on this install.
        </p>
      </div>

      {/* Wraps rather than scrolls. The five tabs need ~500px and a phone gives
          343px, so as a horizontal scroller Health and Audit log sat off-screen
          with nothing to suggest they were there — touch draws no scrollbar. Two
          rows on a phone, one from md up where they fit anyway. */}
      <div className="flex flex-wrap gap-2 pb-1">
        {TABS.map((tab) => {
          const active =
            tab.href === "/admin" ? pathname === "/admin" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors min-h-11 md:min-h-0 md:py-1.5",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {tab.label}
              {tab.href === "/admin/accounts" && pending > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">
                  {pending}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}
