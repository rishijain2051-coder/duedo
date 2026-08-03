import { prisma } from "@/lib/db";
import { jsonAdmin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ADMIN ONLY — the account list, which is also the approval queue.
 *
 * Deliberately not exposed to members: with private reminders, who else has an
 * account here is not their business.
 */
export async function GET() {
  return jsonAdmin(async (admin) => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        approvedAt: true,
        createdAt: true,
      },
      // Pending first — the whole point of the page is to act on them.
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    });
    return users.map((u) => ({ ...u, self: u.id === admin.id }));
  });
}
