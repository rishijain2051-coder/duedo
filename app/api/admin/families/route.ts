import { prisma } from "@/lib/db";
import { jsonAdmin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every family on the install, with members and how much sits on each list. */
export async function GET() {
  return jsonAdmin(async () => {
    const families = await prisma.family.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        members: {
          orderBy: { joinedAt: "asc" },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        _count: { select: { reminders: true } },
      },
    });

    return families.map((f) => ({
      id: f.id,
      name: f.name,
      joinCode: f.joinCode,
      createdAt: f.createdAt,
      reminderCount: f._count.reminders,
      members: f.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
      })),
    }));
  });
}
