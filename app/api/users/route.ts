import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { jsonAdmin } from "@/lib/http";

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
        approvedAt: true,
        emailVerifiedAt: true,
        createdAt: true,
        _count: {
          select: { reminders: true, families: true, pushDevices: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Pending first — the whole point of the page is to act on them. This used to
    // be `orderBy: status asc`, which sorts the *word*: "active" comes before
    // "pending", so on any install with more than a handful of approved accounts
    // the queue was buried at the bottom of the list.
    const RANK: Record<string, number> = { pending: 0, active: 1, rejected: 2 };
    users.sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9));

    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      status: u.status,
      accountType: u.accountType,
      approvedAt: u.approvedAt,
      emailVerifiedAt: u.emailVerifiedAt,
      createdAt: u.createdAt,
      self: u.id === admin.id,
      counts: {
        reminders: u._count.reminders,
        families: u._count.families,
        devices: u._count.pushDevices,
      },
    }));
  });
}
