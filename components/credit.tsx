import { cn } from "@/lib/utils";
import { copyrightYear } from "@/lib/time";

/** Single source of truth for the attribution, so it can't drift between screens. */
export const DEVELOPER = "Draveta Technologies";

export function Credit({ className }: { className?: string }) {
  return (
    <p className={cn("text-[11px] leading-snug text-muted-foreground", className)}>
      {/* copyrightYear, not new Date().getFullYear(). This renders on the server and
          again in the browser, and those two clocks are in different zones — see the
          note on copyrightYear for the five and a half hours a year when they
          disagree and take the footer's hydration with them. */}
      © {copyrightYear()} · Developed by {DEVELOPER}
    </p>
  );
}
