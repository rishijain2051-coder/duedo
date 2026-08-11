import type { Metadata } from "next";
import { AdminShell } from "./admin-shell";

/**
 * A server layout whose only job is the metadata.
 *
 * The admin chrome needs `usePathname` to mark the current tab, so it has to be a
 * client component — and a client component cannot export `metadata`. Splitting the two
 * is what lets every admin screen have its own title without making the shell a server
 * component it cannot be.
 */
/**
 * The template is explicit rather than inherited.
 *
 * A parent's plain-string title does not pass a template down to grandchildren, so the
 * admin sub-pages were resolving to whatever literal string they set while /admin itself
 * picked up "· DueDo" from the group above. Naming the template here is what makes the
 * whole branch consistent: "Accounts · Admin", from a segment that only says "Accounts".
 */
export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  description: "Every account, family and delivery on this install.",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
