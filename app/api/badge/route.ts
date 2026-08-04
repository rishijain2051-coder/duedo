import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { familyIdsFor } from "@/lib/families";
import { countOutstandingFor } from "@/lib/recipients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The two numbers the chrome shows: the app badge and the header's unread dot.
 *
 * Split out because both were being taken from something far heavier. The badge came
 * from /reports/dashboard, which computes six aggregates to yield one of them, and
 * the header fetched up to 100 notification rows and counted them client-side to
 * render a single digit. This is two COUNTs, and it is re-fetched on every return to
 * the app — which is exactly when the numbers are most likely to be stale.
 */
export async function GET() {
  return json(async (user) => {
    const familyIds = await familyIdsFor(user.id);
    const [outstanding, unreadNotifications] = await Promise.all([
      countOutstandingFor(user.id, familyIds, new Date()),
      prisma.notification.count({ where: { userId: user.id, read: false } }),
    ]);
    return { outstanding, unreadNotifications };
  });
}
