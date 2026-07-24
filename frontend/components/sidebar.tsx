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
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/reminders", label: "Reminders", icon: ListTodo },
  { href: "/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/categories", label: "Categories", icon: Folder },
  { href: "/family", label: "Family", icon: Users },
  { href: "/notifications", label: "Notifications", icon: Bell },
];

export function Sidebar() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside className="w-64 border-r bg-card/50 glass hidden md:flex flex-col">
      <div className="p-6 border-b border-border/50">
        <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">
          PRO-SYS
        </h1>
        <p className="text-xs text-muted-foreground mt-1">Life Management ERP</p>
      </div>

      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-5 w-5" /> {label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border/50">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
            pathname.startsWith("/settings")
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Settings className="h-5 w-5" /> Settings
        </Link>
      </div>
    </aside>
  );
}
