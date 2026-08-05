import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { clientId, HttpError, json, readJson } from "@/lib/http";
import { findVisibleReminder } from "@/lib/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Long enough for "I'll pay this on Monday, the site was down", short of an essay. */
const MAX_LENGTH = 1000;
/** Newest last, so the list reads like a conversation. Older ones are rarely wanted. */
const TAKE = 50;

/**
 * Comments on a reminder, so a shared list doesn't need a chat app beside it.
 *
 * Visibility follows the reminder exactly: `findVisibleReminder` is the same gate the
 * reminder itself uses, so a comment is readable by precisely the people who can read the
 * thing it is attached to. Nothing here re-derives that rule.
 *
 * Allowed on a personal reminder too. It is a note to yourself, which is a perfectly
 * reasonable thing to want and costs nothing to permit.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    const reminder = await findVisibleReminder(id, user.id);
    if (!reminder) throw new HttpError(404, "Not found");

    const rows = await prisma.reminderComment.findMany({
      where: { reminderId: id },
      orderBy: { createdAt: "asc" },
      take: TAKE,
      select: {
        id: true,
        body: true,
        createdAt: true,
        authorId: true,
        author: { select: { name: true } },
      },
    });

    return rows.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      // "Someone who has left" rather than a blank: the account was deleted, and an
      // unattributed comment reads like a bug.
      author: c.author?.name ?? "A former member",
      self: c.authorId === user.id,
    }));
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    const reminder = await findVisibleReminder(id, user.id);
    if (!reminder) throw new HttpError(404, "Not found");

    const body = await readJson(req);
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text) throw new HttpError(400, "Write something first.");
    if (text.length > MAX_LENGTH) {
      throw new HttpError(400, `Keep it under ${MAX_LENGTH} characters.`);
    }

    // An id minted by the client, so a note written offline can be replayed without
    // saying the same thing twice. Comments are append-only and two people writing
    // notes is not a conflict at all — the only thing worth guarding against here is
    // one person's single note arriving twice.
    const commentId = clientId(body.id);
    if (commentId) {
      const mine = await prisma.reminderComment.findFirst({
        // Scoped to this reminder and this author: an id is not permission to
        // overwrite, and this path can only ever return something already theirs.
        where: { id: commentId, reminderId: id, authorId: user.id },
        select: { id: true, body: true, createdAt: true },
      });
      if (mine) return { ...mine, author: user.name, self: true };
    }

    const created = await prisma.reminderComment.create({
      data: {
        reminderId: id,
        authorId: user.id,
        body: text,
        ...(commentId ? { id: commentId } : {}),
      },
      select: { id: true, body: true, createdAt: true },
    });

    // Not audited. The audit log records administrative acts and admin access to other
    // people's data; a household leaving notes for itself is neither, and putting every
    // comment in there would bury the entries that matter.
    return { ...created, author: user.name, self: true };
  }, 201);
}
