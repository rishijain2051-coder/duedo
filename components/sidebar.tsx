"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar as CalendarIcon,
  ListTodo,
  Folder,
  LogOut,
  Settings,
  Bell,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app-context";
import { Credit } from "@/components/credit";

// No "Family" entry any more: reminders are private per account, so there is
// nothing shared to browse. Account approval lives in Settings, for admins only.
const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/reminders", label: "Reminders", icon: ListTodo },
  { href: "/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/categories", label: "Categories", icon: Folder },
  { href: "/notifications", label: "Notifications", icon: Bell },
];

/**
 * `onLogout` is passed only by the mobile drawer. On a desktop the header has the
 * room to carry Logout itself; on a phone it was a mis-tap away from the
 * Notifications bell, so it comes down here with the other account actions.
 */
function NavLinks({ onLogout }: { onLogout?: () => void }) {
  const pathname = usePathname();
  const { settings, isAdmin } = useApp();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // Admins get a count on the Admin link so a waiting signup doesn't sit unnoticed.
  const pending = settings?.pendingApprovals ?? 0;

  return (
    <>
      {/* min-h-0 so this can actually shrink inside a flex column — without it a
          short window pushes the footer block below the sidebar instead. Inert when
          the parent isn't a flex container, which is how the mobile drawer reuses
          this inside one scroll area. */}
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-4">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              // aria-current, because "you are here" was carried by colour alone —
              // which says nothing to a screen reader and nothing in forced-colors
              // mode, where the tint is dropped.
              aria-current={active ? "page" : undefined}
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

      <div className="shrink-0 space-y-1 border-t border-border/50 p-4">
        {isAdmin && (
          <Link
            href="/admin"
            aria-current={pathname.startsWith("/admin") ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors min-h-12 md:min-h-0",
              pathname.startsWith("/admin")
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <ShieldCheck className="h-5 w-5" /> Admin
            {pending > 0 && (
              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">
                {pending}
              </span>
            )}
          </Link>
        )}
        <Link
          href="/settings"
          aria-current={pathname.startsWith("/settings") ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors min-h-12 md:min-h-0",
            pathname.startsWith("/settings")
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Settings className="h-5 w-5" /> Settings
        </Link>
        {onLogout && (
          <button
            onClick={onLogout}
            className="flex w-full min-h-12 items-center gap-3 rounded-md px-3 py-2.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-5 w-5" /> Log out
          </button>
        )}
        <Credit className="mt-3 px-3" />
      </div>
    </>
  );
}

function Wordmark({ small }: { small?: boolean }) {
  return (
    <div>
      <h1
        className={cn(
          // .wordmark carries the forced-colors fallback: the gradient is painted
          // through transparent text, and forced-colors drops background images,
          // which would otherwise leave the app name invisible.
          "wordmark bg-gradient-to-r from-primary to-primary-soft bg-clip-text font-bold text-transparent",
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
  const { logout } = useApp();

  // Escape closes it. The drawer covers the whole screen, so without this a
  // keyboard user who opened it had no way back except the close button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* touch-none so a swipe that lands on the backdrop doesn't scroll the page
          underneath it. The app's scroll container is a div rather than the body,
          so locking body overflow would do nothing here. */}
      <div
        className="absolute inset-0 touch-none bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* All three insets, not just the top: `fixed` puts this outside the padding
          body applies, so sideways on a notched phone the nav sat under the notch,
          and the Log out row at the bottom under the home indicator. */}
      <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r bg-card pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border/50 p-5">
          <Wordmark small />
          <button
            onClick={onClose}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* The whole nav is one scroll area, rather than a scrolling list with a
            pinned footer beneath it. Held sideways on a small phone the drawer is
            320px tall, and the pinned footer ran 28px past the bottom edge — Log out
            and the credit line were unreachable, while the list above was crushed to
            a 32px window. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <NavLinks onLogout={() => logout()} />
        </div>
      </aside>
    </div>
  );
}
