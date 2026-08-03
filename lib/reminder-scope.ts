import { prisma } from "./db";
import { HttpError } from "./http";
import { assertMember } from "./families";
import { assertCategoryInScope } from "./ownership";

// Validates the *destination* of a reminder write: which list, who it's assigned
// to, and who hears about it.
//
// Split out of the route because create and update both need it and the rules are
// fiddly enough to be worth naming. Nothing here trusts the request body.

interface Destination {
  familyId?: unknown;
  assignedToId?: unknown;
  audience?: unknown;
}

/**
 * Checks a sanitised reminder payload against what the caller may actually do,
 * mutating nothing and throwing on anything invalid.
 *
 * `currentFamilyId` is the reminder's existing list on an update, so a payload
 * that omits `familyId` is validated against where the reminder already lives
 * rather than defaulting to personal.
 */
export async function assertReminderDestination(
  data: Destination & Record<string, unknown>,
  userId: string,
  currentFamilyId: string | null = null,
): Promise<void> {
  const familyId =
    data.familyId === undefined ? currentFamilyId : (data.familyId as string | null);

  if (familyId) {
    // Membership is the gate on writing to a family list at all.
    await assertMember(userId, familyId);
  }

  if (data.assignedToId) {
    if (!familyId) {
      throw new HttpError(400, "Only a family reminder can be assigned to someone.");
    }
    // The assignee must be in the same family, or a reminder could be pointed at
    // a stranger — and lib/recipients would then notify them.
    const target = await prisma.familyMember.findUnique({
      where: {
        familyId_userId: { familyId, userId: data.assignedToId as string },
      },
      select: { id: true },
    });
    if (!target) {
      throw new HttpError(400, "That person isn't in this family.");
    }
  }

  if (data.audience && data.audience !== "owner" && !familyId) {
    throw new HttpError(
      400,
      "A personal reminder can only be addressed to you. Move it to a family list first.",
    );
  }

  if (data.categoryId !== undefined) {
    await assertCategoryInScope(data.categoryId, userId, familyId);
  }
}
