import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { jsonAdmin } from "@/lib/http";
import { effectivePlan } from "@/lib/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ADMIN ONLY — the account list, which is also the approval queue.
 *
 * Deliberately not exposed to members: who else has an account here is not their
 * business. `?q=` filters by name or email, `?status=` by state.
 */
export async function GET(req: NextRequest) {
  return jsonAdmin(async (admin) => {
    const p = req.nextUrl.searchParams;
    const q = p.get("q")?.trim();
    const status = p.get("status");

    const users = await prisma.user.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { email: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        accountType: true,
        isRootAdmin: true,
        plan: true,
        premiumUntil: true,
        planNote: true,
        emailVerifiedAt: true,
        createdAt: true,
        _count: { select: { reminders: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    // Pending first — the whole point of the page is to act on them. This used to
    // be `orderBy: status asc`, which sorts the *word*: "active" comes before
    // "pending", so on any install with more than a handful of approved accounts
    // the queue was buried at the bottom of the list.
    const RANK: Record<string, number> = { pending: 0, active: 1, rejected: 2 };
    users.sort(
      (a, b) =>
        (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) ||
        Number(b.isRootAdmin) - Number(a.isRootAdmin),
    );

    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      status: u.status,
      accountType: u.accountType,
      isRoot: u.isRootAdmin,
      emailVerifiedAt: u.emailVerifiedAt,
      createdAt: u.createdAt,
      self: u.id === admin.id,
      canTransferRoot: admin.isRootAdmin && u.role === "admin" && u.status === "active",
      reminders: u._count.reminders,
      // Both halves, plus what they resolve to. The page needs the raw pair to render
      // an expiry date and the resolved answer to say what they can actually use, and
      // deriving the second in the client would be a second copy of the rule.
      plan: u.plan,
      premiumUntil: u.premiumUntil,
      effectivePlan: effectivePlan(u),
      // Admin-only, and this route already is. The payment note is how a grant is
      // reconciled months later; it is never sent to the account it describes.
      planNote: u.planNote,
      canGrantPlan: admin.isRootAdmin,
    }));
  });
}
