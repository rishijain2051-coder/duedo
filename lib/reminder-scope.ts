import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./http";
import { assertMember, ensureOthersCategory } from "./families";
import { assertCategoryInScope } from "./ownership";
import { assertContactsOwned, parseEscalation } from "./escalation";

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
 * The fields the database insists on, checked before it gets the chance.
 *
 * Prisma will refuse a reminder with no title, no due date or no category — but
 * it refuses by throwing, which `lib/http.ts` can only report as a 500. So the
 * user is told "Internal server error" about their own empty field, and the log
 * fills with unhandled exceptions that look like outages. Checking here turns
 * each one back into a 400 and a sentence.
 *
 * On an update only the fields actually present are checked, so a PATCH that
 * touches one field doesn't have to resend the rest.
 */
export function assertReminderFields(
  data: Record<string, unknown>,
  isCreate: boolean,
): void {
  if (isCreate ? !data.title : data.title !== undefined && !data.title) {
    throw new HttpError(400, "Give the reminder a title.");
  }

  if (data.dueAt === undefined) {
    if (isCreate) throw new HttpError(400, "Give the reminder a due date.");
  } else if (Number.isNaN((data.dueAt as Date).getTime())) {
    // parseDueAt hands back an Invalid Date rather than throwing, so a mangled
    // "2026-13-45" gets this far looking like a Date.
    throw new HttpError(400, "That due date could not be read.");
  }

  // No category check. Picking one is optional now; anything without one is filed
  // under "Others" in assertReminderDestination, once membership has been proved.
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
  isCreate = false,
): Promise<void> {
  const familyId =
    data.familyId === undefined ? currentFamilyId : (data.familyId as string | null);

  if (familyId) {
    // Membership is the gate on writing to a family list at all.
    await assertMember(userId, familyId);
  }

  // "No category" is still a category, because the column is required — see
  // ensureOthersCategory. Deliberately after the membership check above: resolving it
  // first would let a familyId the caller doesn't belong to create a category on that
  // family's list, which is a write to a list they can't even read.
  //
  // An explicit null clears the field on an update as well as a create; undefined on an
  // update means "leave it alone" and is left alone.
  if (data.categoryId === null || (isCreate && data.categoryId === undefined)) {
    data.categoryId = await ensureOthersCategory(
      familyId ? { familyId } : { userId },
    );
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

  // Escalation, validated and normalised in place. Done here rather than in
  // sanitizeReminderInput because it needs the database (to prove the external contacts
  // belong to this caller) and because parseEscalation throws HttpError — both of which
  // that file deliberately stays clear of.
  if (data.escalation !== undefined) {
    const steps = parseEscalation(data.escalation);
    if (steps) await assertContactsOwned(steps, userId);
    // Prisma needs DbNull for "no value" on a Json column; a plain null is rejected.
    data.escalation = steps ?? Prisma.DbNull;
  }
}
