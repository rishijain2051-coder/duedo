import { prisma } from "./db";
import { HttpError } from "./http";
import { familyIdsFor, membershipIn } from "./families";

// Visibility and permission guards.
//
// Every guard answers with a 404 rather than a 403 when something isn't visible:
// a 403 would confirm that the id exists and belongs to somebody else, which is
// exactly the thing not worth telling anyone. Once a caller can legitimately see
// a row but may not change it, 403 is correct — they already know it exists.
//
// Admins bypass none of this. Admin access to another account's data goes through
// jsonAdmin() and the /api/admin/* routes, so it is always an explicit, audited
// code path rather than a quiet exemption buried in a guard.

/** Personal (userId, no family) or family (a family the caller belongs to). */
async function visibleScope(userId: string) {
  const familyIds = await familyIdsFor(userId);
  return {
    OR: [{ userId, familyId: null }, ...(familyIds.length ? [{ familyId: { in: familyIds } }] : [])],
  };
}

/**
 * A reminder the caller is allowed to *see*: their own personal one, or one on
 * the shared list of a family they belong to.
 */
export async function findVisibleReminder(id: string, userId: string) {
  const reminder = await prisma.reminder.findFirst({
    where: { id, ...(await visibleScope(userId)) },
  });
  if (!reminder) throw new HttpError(404, "Reminder not found");
  return reminder;
}

/** Prisma `where` fragment listing everything the caller may see. */
export async function visibleReminderWhere(userId: string) {
  return visibleScope(userId);
}

export type ReminderAction = "edit" | "complete";

/**
 * Checks the caller may perform `action` on a reminder, and returns it.
 *
 * | action   | personal | family                    |
 * | -------- | -------- | ------------------------- |
 * | edit     | creator  | creator or head           |
 * | complete | creator  | **any member**            |
 *
 * "complete" covers snoozing too, and any member of the family may do it — that
 * is what makes a shared list shared. Restricting it to the creator, assignee and
 * head would mean whoever actually paid the electricity bill often couldn't tick
 * it off, which is the exact case the family list exists for.
 *
 * Editing — retitling, moving the date, reassigning, changing who gets notified —
 * stays with the creator and the head, because those change the thing for everyone
 * rather than just resolving it.
 */
export async function assertReminderAction(
  id: string,
  userId: string,
  action: ReminderAction,
) {
  const reminder = await findVisibleReminder(id, userId);

  if (reminder.userId === userId) return reminder;

  // Personal reminder that isn't theirs is already impossible — findVisible
  // would have 404'd — so anything left here is a family reminder.
  if (!reminder.familyId) throw new HttpError(404, "Reminder not found");

  const membership = await membershipIn(userId, reminder.familyId);
  if (action === "complete" && membership) return reminder;
  if (membership?.role === "head") return reminder;

  throw new HttpError(
    403,
    "Only the person who created this reminder, or the family head, can change it.",
  );
}

/**
 * Throws 404 unless `categoryId` exists and is in scope for the reminder being
 * written: a personal reminder must use one of the caller's own categories, and a
 * family reminder must use one of that family's.
 *
 * Without this a caller could attach their reminder to a category they can't see
 * and read the name back out of the `include`.
 */
export async function assertCategoryInScope(
  categoryId: unknown,
  userId: string,
  familyId: string | null,
): Promise<void> {
  if (typeof categoryId !== "string" || !categoryId) {
    throw new HttpError(400, "A category is required.");
  }
  const found = await prisma.category.findFirst({
    where: familyId ? { id: categoryId, familyId } : { id: categoryId, userId },
    select: { id: true },
  });
  if (!found) throw new HttpError(404, "Category not found");
}
