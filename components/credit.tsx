import { cn } from "@/lib/utils";

/** Single source of truth for the attribution, so it can't drift between screens. */
export const DEVELOPER = "Draveta Technologies";

export function Credit({ className }: { className?: string }) {
  return (
    <p className={cn("text-[11px] leading-snug text-muted-foreground", className)}>
      © {new Date().getFullYear()} · Developed by {DEVELOPER}
    </p>
  );
}
