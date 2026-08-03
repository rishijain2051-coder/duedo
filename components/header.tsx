"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, LogOut, Menu, UserCircle } from "lucide-react";
import { useApp } from "@/components/app-context";
import { api } from "@/services/api";

export function Header({ onMenuToggle }: { onMenuToggle?: () => void }) {
  const { user, logout } = useApp();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let active = true;
    api.notifications
      .list()
      .then((n) => {
        if (active) setUnread(n.filter((x) => !x.read).length);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <header className="h-14 md:h-16 border-b bg-card/30 glass flex items-center justify-between px-4 md:px-6 z-10 pt-[env(safe-area-inset-top)]">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="md:hidden -ml-2 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Open menu"
        >
          <Menu className="h-6 w-6" />
        </button>
        <span className="md:hidden text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary-soft">
          PRO-SYS
        </span>
        <div className="hidden md:flex items-center gap-2 text-sm">
          <UserCircle className="h-5 w-5 text-muted-foreground" />
          <span className="text-muted-foreground">Signed in as</span>
          <span className="font-semibold">{user?.name ?? "…"}</span>
        </div>
      </div>

      <div className="flex items-center gap-1 md:gap-2">
        <Link
          href="/notifications"
          className="relative flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-accent md:h-9 md:w-9"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5 text-muted-foreground" />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white md:right-0 md:top-0">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>
        <button
          onClick={() => logout()}
          aria-label="Log out"
          className="-mr-2 flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:mr-0 md:h-9"
        >
          <LogOut className="h-5 w-5 md:h-4 md:w-4" />
          <span className="hidden md:inline">Logout</span>
        </button>
      </div>
    </header>
  );
}
