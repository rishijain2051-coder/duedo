"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar as CalendarIcon,
  ListTodo,
  Folder,
  Settings,
  Bell,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app-context";

// No "Family" entry any more: reminders are private per account, so there is
// nothing shared to browse. Account approval lives in Settings, for admins only.
const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/reminders", label: "Reminders", icon: ListTodo },
  { href: "/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/categories", label: "Categories", icon: Folder },
  { href: "/notifications", label: "Notifications", icon: Bell },
];

function NavLinks() {
  const pathname = usePathname();
  const { settings } = useApp();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // Admins get a count on Settings so a waiting signup doesn't sit unnoticed.
  const pending = settings?.pendingApprovals ?? 0;

  return (
    <>
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md font-medium transition-colors",
                "min-h-12 md:min-h-0",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" /> {label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border/50">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors min-h-12 md:min-h-0",
            pathname.startsWith("/settings")
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Settings className="h-5 w-5" /> Settings
          {pending > 0 && (
            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">
              {pending}
            </span>
          )}
        </Link>
      </div>
    </>
  );
}

function Wordmark({ small }: { small?: boolean }) {
  return (
    <div>
      <h1
        className={cn(
          "font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary-soft",
          small ? "text-xl" : "text-2xl",
        )}
      >
        PRO-SYS
      </h1>
      <p className="text-xs text-muted-foreground mt-1">Reminders</p>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="w-64 border-r bg-card/50 glass hidden md:flex flex-col">
      <div className="p-6 border-b border-border/50">
        <Wordmark />
      </div>
      <NavLinks />
    </aside>
  );
}

export function MobileNav({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside className="absolute left-0 top-0 h-full w-64 bg-card border-r flex flex-col shadow-xl pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between p-5 border-b border-border/50">
          <Wordmark small />
          <button
            onClick={onClose}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <NavLinks />
      </aside>
    </div>
  );
}
