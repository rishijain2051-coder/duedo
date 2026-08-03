import { prisma } from "./db";
import { HttpError } from "./http";

// Ownership guards.
//
// Reminders are private, so "does this row exist?" and "is it yours?" have to be
// the same question. Every guard here answers with a 404 rather than a 403: a 403
// would confirm that some other account owns that id, which is exactly the thing
// not worth telling anyone.

/** Throws 404 unless `categoryId` exists and belongs to `userId`. */
export async function assertOwnedCategory(
  categoryId: unknown,
  userId: string,
): Promise<void> {
  if (typeof categoryId !== "string" || !categoryId) {
    throw new HttpError(400, "A category is required.");
  }
  const found = await prisma.category.findFirst({
    where: { id: categoryId, userId },
    select: { id: true },
  });
  if (!found) throw new HttpError(404, "Category not found");
}

/** The caller's reminder, or 404. */
export async function findOwnedReminder(id: string, userId: string) {
  const reminder = await prisma.reminder.findFirst({ where: { id, userId } });
  if (!reminder) throw new HttpError(404, "Reminder not found");
  return reminder;
}
