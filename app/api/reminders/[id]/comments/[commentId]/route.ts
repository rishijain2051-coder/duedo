import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";
import { findVisibleReminder } from "@/lib/ownership";
import { membershipIn } from "@/lib/families";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deletes a comment. The author, or the family's head.
 *
 * The head is included because a shared list needs someone able to remove something said
 * in anger, and the alternative — nobody can, ever — leaves a household with a permanent
 * record of a bad afternoon. It is the same reasoning that gives the head the power to
 * remove a member.
 *
 * No editing. An edited comment in a thread other people have already read is a way to
 * change what you appear to have said; deleting is visible by its absence.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; commentId: string }> },
) {
  return json(async (user) => {
    const { id, commentId } = await ctx.params;
    const reminder = await findVisibleReminder(id, user.id);
    if (!reminder) throw new HttpError(404, "Not found");

    const comment = await prisma.reminderComment.findUnique({
      where: { id: commentId },
      select: { id: true, authorId: true, reminderId: true },
    });
    // Checked against *this* reminder, so a comment id from a thread the caller can see
    // can't be used to delete one from a thread they can't.
    if (!comment || comment.reminderId !== id) throw new HttpError(404, "Not found");

    let allowed = comment.authorId === user.id;
    if (!allowed && reminder.familyId) {
      const membership = await membershipIn(user.id, reminder.familyId);
      allowed = membership?.role === "head";
    }
    if (!allowed) throw new HttpError(403, "Only the author or the family head can.");

    await prisma.reminderComment.delete({ where: { id: commentId } });
    return { deleted: true };
  });
}
