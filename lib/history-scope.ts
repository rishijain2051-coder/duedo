import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./http";
import { familyIdsFor } from "./families";

// Who may read which completions.
//
// This exists as its own module because the insight routes are the first thing in the app
// to read history rather than reminders, and so they do not pass through
// lib/ownership.ts at all. A spending total is a new way to read somebody else's data:
// "what did this household spend on medical bills" is exactly as private as the reminders
// behind it, and nothing in the existing scope helpers would have stopped it.
//
// One function, used by every insight route, so there is a single answer to "whose
// money is this".

/** `"mine"`, or a family id. Matches the scope the reminders page already uses. */
export type Scope = "mine" | (string & {});

export function parseScope(raw: string | null | undefined): Scope {
  const value = (raw ?? "mine").trim();
  return value === "" ? "mine" : value;
}

/**
 * `"u:<id>"` or `"f:<id>"` — the rollup's scope key.
 *
 * A single string because Postgres does not treat NULLs as equal in a unique index, so a
 * (userId, familyId, month, category) key would silently accept duplicate rows and the
 * rollup would double every time it ran.
 */
export function scopeKeyFor(userId: string, scope: Scope): string {
  return scope === "mine" ? `u:${userId}` : `f:${scope}`;
}

/**
 * A `ReminderHistory` filter for what this caller may see in this scope, membership
 * checked first.
 *
 * Personal scope is narrow deliberately: `userId` (the reminder's creator) *and* no
 * family. Without the second half, a family reminder you created would count towards
 * your personal spend as well as the household's, and the two figures would never
 * reconcile.
 *
 * Family scope is every completion on that list whoever filed it — that is what a shared
 * list means. It does not include members' personal spend, which is theirs.
 *
 * 404 rather than 403 for a family the caller isn't in, matching lib/ownership.ts: a 403
 * confirms the family exists.
 */
export async function historyScopeWhere(
  userId: string,
  scope: Scope,
): Promise<Prisma.ReminderHistoryWhereInput> {
  if (scope === "mine") {
    return { reminder: { userId, familyId: null } };
  }

  const familyIds = await familyIdsFor(userId);
  if (!familyIds.includes(scope)) {
    throw new HttpError(404, "Not found");
  }
  return { reminder: { familyId: scope } };
}

/**
 * The same rule for *upcoming* reminders, which the cash-flow forecast needs.
 *
 * Kept beside its history counterpart rather than reusing visibleReminderWhere(): that
 * returns everything the caller can see across every scope at once, which is right for a
 * dashboard count and wrong here — a forecast has to be attributable to one list or the
 * number means nothing.
 */
export async function reminderScopeWhere(
  userId: string,
  scope: Scope,
): Promise<Prisma.ReminderWhereInput> {
  if (scope === "mine") return { userId, familyId: null };

  const familyIds = await familyIdsFor(userId);
  if (!familyIds.includes(scope)) {
    throw new HttpError(404, "Not found");
  }
  return { familyId: scope };
}

/** Every scope this account can ask about — used by the rollup, which has no request. */
export async function scopesFor(userId: string): Promise<Scope[]> {
  return ["mine", ...(await familyIdsFor(userId))];
}

/**
 * Resolves the categories referenced by a set of completions to names, in one query.
 *
 * Reads the *live* category rather than freezing a label on the history row. For the
 * three months of detail this covers, showing the current name is what people expect —
 * they renamed it because that is what they want to call it. The rollup freezes its own
 * copy, so a closed month keeps the name it had.
 */
export async function categoryNames(
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.category.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}
