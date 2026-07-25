"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, LogOut, Menu, UserCircle } from "lucide-react";
import { useMembers } from "@/components/member-context";
import { api } from "@/services/api";

export function Header({ onMenuToggle }: { onMenuToggle?: () => void }) {
  const { currentMember, logout } = useMembers();
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
    <header className="h-14 md:h-16 border-b bg-card/30 glass flex items-center justify-between px-4 md:px-6 z-10">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="md:hidden rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="md:hidden text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">
          PRO-SYS
        </span>
        <div className="hidden md:flex items-center gap-2 text-sm">
          <UserCircle className="h-5 w-5 text-muted-foreground" />
          <span className="text-muted-foreground">Signed in as</span>
          <span className="font-semibold">{currentMember?.name ?? "…"}</span>
        </div>
      </div>

      <div className="flex items-center gap-1 md:gap-2">
        <Link
          href="/notifications"
          className="relative p-2 rounded-full hover:bg-accent transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5 text-muted-foreground" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>
        <button
          onClick={() => logout()}
          className="flex items-center gap-2 rounded-md px-2 md:px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden md:inline">Logout</span>
        </button>
      </div>
    </header>
  );
}
