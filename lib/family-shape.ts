/**
 * The one definition of a family membership payload, and how to fetch it.
 *
 * Two routes serve it — /api/families, and /api/bootstrap, which is what the app
 * shell actually loads — and they built it independently, comment for comment. That
 * is the same shape of mistake that made a granted plan invisible for days: a field
 * added to the route somebody happened to be looking at, and not to the one the shell
 * reads, with nothing failing anywhere. Once was a bug; twice is a pattern worth
 * removing rather than re-fixing.
 */

/** Every column either route needs, including the members and their users. */
export const FAMILY_MEMBERSHIP_INCLUDE = {
  family: {
    include: {
      members: {
        orderBy: { joinedAt: "asc" },
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  },
} as const;

/** Exactly what FAMILY_MEMBERSHIP_INCLUDE returns. */
export interface MembershipRow {
  role: string;
  family: {
    id: string;
    name: string;
    joinCode: string;
    createdAt: Date;
    showRanking: boolean;
    showStreaks: boolean;
    allowNudges: boolean;
    monthlyReportToHead: boolean;
    members: {
      role: string;
      joinedAt: Date;
      user: { id: string; name: string; email: string };
    }[];
  };
}

export function shapeFamilies(memberships: MembershipRow[], viewerId: string) {
  return memberships.map(({ role, family }) => ({
    id: family.id,
    name: family.name,
    role,
    createdAt: family.createdAt,
    // Only the head sees it. A plain member has no business handing it out, and since
    // the code alone now admits someone, that matters more than it used to.
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
      self: m.user.id === viewerId,
    })),
  }));
}
