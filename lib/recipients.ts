import { prisma } from "./db";

// Who hears about a reminder.
//
// One place, deliberately. The dispatcher needs it to fan out, and the app badge
// needs it to count what a person is on the hook for — if those two disagreed,
// the icon would show a number the user can't reconcile with anything on screen.

// Audience is declared in @/types rather than here: the reminder form needs the
// labels, and this module imports prisma so a client component can't touch it.
export { isAudience, type Audience } from "@/types";

/** The shape the dispatcher already has loaded; keeps this callable without a refetch. */
export interface RecipientSource {
  userId: string;
  familyId: string | null;
  assignedToId: string | null;
  audience: string;
}

/**
 * Resolves a reminder to the set of user ids that should be alerted.
 *
 * `family` is the only case that needs a query, and it is filtered to approved
 * accounts — a pending or rejected member is dormant and must not be notified.
 * Falls back to the creator whenever the intended target has gone (an assignee
 * who left the family, say), because silence would be the worse failure.
 */
export async function recipientsFor(r: RecipientSource): Promise<string[]> {
  // A personal reminder has no audience beyond its owner, whatever the column says.
  if (!r.familyId) return [r.userId];

  if (r.audience === "assignee") {
    return [r.assignedToId ?? r.userId];
  }

  if (r.audience === "family") {
    const members = await prisma.familyMember.findMany({
      where: { familyId: r.familyId, user: { status: "active" } },
      select: { userId: true },
    });
    const ids = members.map((m) => m.userId);
    return ids.length > 0 ? ids : [r.userId];
  }

  return [r.userId];
}

/**
 * How many reminders this person is currently on the hook for — drives the app
 * badge. Counts their own overdue personal reminders plus any family reminder
 * that is due and addressed to them.
 *
 * Mirrors recipientsFor in SQL rather than looping in JS, because this runs on
 * every page load and once per push.
 */
export function countOutstandingFor(
  userId: string,
  familyIds: string[],
  now = new Date(),
): Promise<number> {
  return prisma.reminder.count({
    where: {
      status: "active",
      dueAt: { lte: now },
      OR: [
        // Personal reminders, and family reminders addressed to their creator.
        { userId, familyId: null },
        { userId, familyId: { not: null }, audience: "owner" },
        // Assigned to them.
        { familyId: { in: familyIds }, audience: "assignee", assignedToId: userId },
        // Assigned to nobody, so it falls back to the creator.
        {
          familyId: { in: familyIds },
          audience: "assignee",
          assignedToId: null,
          userId,
        },
        // Addressed to the whole family.
        { familyId: { in: familyIds }, audience: "family" },
      ],
    },
  });
}
