import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { familyIdsFor } from "@/lib/families";
import { countOutstandingFor } from "@/lib/recipients";
import { SETTINGS_SELECT, shapeSettings } from "@/lib/settings-shape";
import { isPushConfigured } from "@/lib/push";
import { isMailConfigured } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the app shell needs to render, in one request.
 *
 * The shell used to make four, three of them strictly serial: /auth/me, then
 * /settings, then /families, plus a /reports/dashboard purely for the badge number.
 * Each one is a separate serverless function — so potentially a separate cold start
 * — and each re-resolves the session against the database before doing its own work.
 * Nothing could paint until the chain finished.
 *
 * The badge counts are the other half of it. The header was fetching up to 100
 * notification rows to render one digit, and the app badge came from a six-aggregate
 * dashboard query to read a single number. Both are COUNTs here.
 *
 * `/auth/me` is still needed by the login screen, which has no session yet; this
 * route is only for the authenticated shell.
 */
export async function GET() {
  return json(async (user) => {
    const familyIds = await familyIdsFor(user.id);

    const [
      row,
      passkeyCount,
      pushSubscriptions,
      unreadNotifications,
      outstanding,
      memberships,
    ] = await Promise.all([
      // The same select the settings route uses. This route hand-rolled its own once,
      // and the two drifted the moment a column was added: plan and premiumUntil went
      // into /api/settings and not here, so the shell — which reads *this* — saw no
      // plan at all and showed Free to an account that had been granted a year.
      prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: SETTINGS_SELECT }),
      prisma.passkey.count({ where: { userId: user.id } }),
      prisma.pushSubscription.count({ where: { userId: user.id, blockedAt: null } }),
      prisma.notification.count({ where: { userId: user.id, read: false } }),
      countOutstandingFor(user.id, familyIds, new Date()),
      // Only fetched for an account that is actually in a family — a solo account
      // would otherwise pay for a join to prove it has none.
      familyIds.length
        ? prisma.familyMember.findMany({
            where: { userId: user.id },
            orderBy: { joinedAt: "asc" },
            include: {
              family: {
                include: {
                  members: {
                    orderBy: { joinedAt: "asc" },
                    include: { user: { select: { id: true, name: true, email: true } } },
                  },
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    return {
      user: {
        id: user.id,
        name: row.name,
        email: row.email,
        role: row.role === "admin" ? "admin" : "member",
        accountType: row.accountType === "family" ? "family" : "solo",
      },
      settings: shapeSettings(row, {
        passkeyCount,
        pushSubscriptions,
        pushConfigured: isPushConfigured(),
        mailConfigured: isMailConfigured(),
      }),
      families: memberships.map(({ role, family }) => ({
        id: family.id,
        name: family.name,
        role,
        createdAt: family.createdAt,
        joinCode: role === "head" ? family.joinCode : null,
        /**
         * What the family has opted into.
         *
         * Carried on every load rather than fetched with the scoreboard, because the
         * reminders page needs `allowNudges` and has no scoreboard — and because the
         * scoreboard never returned `monthlyReportToHead` at all, so the head's switch for
         * it showed as on however it was actually set. Four booleans is a cheaper payload
         * than a second request, and one source of truth beats two.
         */
        flags: {
          showRanking: family.showRanking,
          showStreaks: family.showStreaks,
          allowNudges: family.allowNudges,
          monthlyReportToHead: family.monthlyReportToHead,
        },
        members: family.members.map((m) => ({
          id: m.user.id,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          joinedAt: m.joinedAt,
          self: m.user.id === user.id,
        })),
      })),
      badge: { outstanding, unreadNotifications },
      // Carried here so the update check stops polling /api/version on the critical
      // path — one fewer function invocation per load, for a value that only changes
      // on deploy.
      buildId: process.env.APP_BUILD_ID || "unknown",
    };
  });
}
