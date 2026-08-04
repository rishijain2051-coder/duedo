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
    // The height is the bar *plus* the notch inset, not a fixed total.
    //
    // This was `h-14 pt-[env(safe-area-inset-top)]`, and with border-box sizing the
    // padding came out of the 56px rather than adding to it: on an installed PWA on
    // a notched iPhone (inset 59px) the content box collapsed to 2px, so the
    // hamburger, bell and logout sat half behind the status bar and half over the
    // page below the header's own bottom border. Invisible in a desktop browser,
    // where the inset is 0.
    <header
      className="z-10 flex min-h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between border-b bg-card/30 px-4 pt-[env(safe-area-inset-top)] glass md:min-h-[calc(4rem+env(safe-area-inset-top))] md:px-6"
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="md:hidden -ml-2 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Open menu"
        >
          <Menu className="h-6 w-6" />
        </button>
        <span className="wordmark bg-gradient-to-r from-primary to-primary-soft bg-clip-text text-lg font-bold text-transparent md:hidden">
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
          // -mr-2 mirrors the hamburger's -ml-2, so both tap targets sit 9px from
          // their edge. It used to be on the logout button; with that gone from the
          // mobile header the bell was left 8px shy of the corner. md:mr-0 because
          // on a desktop the bell isn't the last child and pulling it right would
          // just eat the gap before Logout.
          className="relative -mr-2 flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-accent md:mr-0 md:h-9 md:w-9"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5 text-muted-foreground" />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white md:right-0 md:top-0">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>
        {/* Desktop only. On a phone this sat 4px from the Notifications bell —
            two 44px targets side by side, one of which ends the session with no
            confirmation — so a thumb aimed at the bell could sign you out. It
            lives in the drawer on mobile instead, next to Settings, which is
            where the other account-level actions already are. */}
        <button
          onClick={() => logout()}
          aria-label="Log out"
          className="mr-0 hidden h-9 items-center justify-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:flex"
        >
          <LogOut className="h-4 w-4" />
          <span>Logout</span>
        </button>
      </div>
    </header>
  );
}
