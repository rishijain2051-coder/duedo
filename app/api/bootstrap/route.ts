import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { familyIdsFor } from "@/lib/families";
import { countOutstandingFor } from "@/lib/recipients";

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
      prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          name: true,
          email: true,
          role: true,
          accountType: true,
          timezone: true,
          defaultTime: true,
          overdueRepeatMins: true,
          idleTimeoutMins: true,
          emailOptIn: true,
          pushOptIn: true,
          password_hash: true,
        },
      }),
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
      settings: {
        name: row.name,
        email: row.email,
        role: row.role === "admin" ? "admin" : "member",
        accountType: row.accountType === "family" ? "family" : "solo",
        timezone: row.timezone,
        defaultTime: row.defaultTime,
        overdueRepeatMins: row.overdueRepeatMins,
        idleTimeoutMins: row.idleTimeoutMins,
        emailOptIn: row.emailOptIn,
        pushOptIn: row.pushOptIn,
        pinSet: Boolean(row.password_hash),
        passkeyCount,
        pushConfigured: Boolean(process.env.VAPID_PUBLIC_KEY),
        mailConfigured: Boolean(
          process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
        ),
        pushSubscriptions,
      },
      families: memberships.map(({ role, family }) => ({
        id: family.id,
        name: family.name,
        role,
        createdAt: family.createdAt,
        joinCode: role === "head" ? family.joinCode : null,
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
