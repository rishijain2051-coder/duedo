"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /**
   * What was focused before the dialog opened, so it can be restored on close.
   *
   * Recorded while *closed*, not when opening. Several of these forms autoFocus
   * their first field, and React applies that during the commit that mounts the
   * panel — before any effect here could run. An effect that read activeElement at
   * open time would therefore capture the field inside the dialog, which is gone by
   * the time focus needs restoring.
   *
   * Safe to keep in a ref because this component stays mounted while closed: it
   * renders null rather than being unmounted by its caller. The render that flips
   * `open` to true is the parent's state update, so the value captured on the
   * previous render is the trigger that caused it.
   */
  const lastOutside = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) return;
    lastOutside.current = document.activeElement as HTMLElement | null;
  }, [open]);

  /**
   * Move focus into the panel on open, and back out again on close.
   *
   * Without this, opening the reminder form left focus on the button behind the
   * overlay: a keyboard or screen-reader user had to tab through the whole page
   * underneath before reaching the first field.
   */
  useEffect(() => {
    if (!open) return;
    // Skipped when the content autoFocused something itself — moving focus again
    // would drag the caret out of the field the form chose.
    if (!panel.current?.contains(document.activeElement)) {
      const first = panel.current?.querySelector<HTMLElement>(
        // Not the close button: landing there makes Enter and Escape do the same
        // thing, which is a surprising way to lose a half-filled form.
        "input:not([type=hidden]), select, textarea",
      );
      (first ?? panel.current)?.focus();
    }
    return () => {
      const previous = lastOutside.current;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      // touch-none stops a drag on the backdrop from scrolling the page behind it.
      // The panel puts it back, or the form itself couldn't be scrolled.
      className="fixed inset-0 z-50 flex touch-none items-center justify-center bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          // max-h-app-panel is 90dvh with a 90vh fallback: at 90vh the footer
          // buttons of a long form sat behind the mobile browser toolbar.
          "max-h-app-panel w-full max-w-lg touch-auto overflow-y-auto overscroll-contain rounded-xl border bg-card text-card-foreground shadow-lg outline-none glass",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/60 p-5">
          <h3 id={titleId} className="text-lg font-semibold">
            {title}
          </h3>
          {/* 44px, not the 28px this used to be — it's the only way out of a
              full-screen sheet on a phone besides the backdrop. */}
          <button
            onClick={onClose}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:-mr-1 sm:h-9 sm:w-9"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
