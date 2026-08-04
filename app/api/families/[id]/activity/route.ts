import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { assertMember } from "@/lib/families";
import { round2 } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TAKE = 30;

/**
 * A shared timeline: who completed what, and what anyone said about it.
 *
 * This is the always-on half of accountability. It is not a ranking and it is not scored —
 * it is just visible, which turns out to be most of what a household needs. "Dad completed
 * the electricity bill two hours ago" removes the phone call, and nobody has to be told
 * they are behind for it to work.
 *
 * Never gated on the family's flags, unlike the scoreboard. A record of what happened is
 * not the part that can go wrong socially.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async (user) => {
    const { id } = await ctx.params;
    await assertMember(user.id, id);

    // Two lists, merged and re-sorted, rather than one union query. Both are small and
    // indexed; a raw UNION would buy nothing and cost readability.
    const [completions, comments] = await Promise.all([
      prisma.reminderHistory.findMany({
        where: { reminder: { familyId: id } },
        orderBy: { completedOn: "desc" },
        take: TAKE,
        select: {
          id: true,
          completedOn: true,
          amount: true,
          cycleDueAt: true,
          completedBy: { select: { name: true } },
          reminder: { select: { id: true, title: true } },
        },
      }),
      prisma.reminderComment.findMany({
        where: { reminder: { familyId: id } },
        orderBy: { createdAt: "desc" },
        take: TAKE,
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { name: true } },
          reminder: { select: { id: true, title: true } },
        },
      }),
    ]);

    const events = [
      ...completions.map((c) => ({
        id: `done-${c.id}`,
        kind: "completed" as const,
        at: c.completedOn,
        who: c.completedBy?.name ?? "A former member",
        reminderId: c.reminder?.id ?? null,
        title: c.reminder?.title ?? "(deleted reminder)",
        amount: round2(c.amount ?? 0),
        // Only stated when it is knowable. A null cycle means the completion predates the
        // column, not that it was late.
        onTime: c.cycleDueAt ? c.completedOn <= c.cycleDueAt : null,
        body: null as string | null,
      })),
      ...comments.map((c) => ({
        id: `said-${c.id}`,
        kind: "commented" as const,
        at: c.createdAt,
        who: c.author?.name ?? "A former member",
        reminderId: c.reminder?.id ?? null,
        title: c.reminder?.title ?? "(deleted reminder)",
        amount: 0,
        onTime: null,
        body: c.body,
      })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, TAKE);

    return events;
  });
}
