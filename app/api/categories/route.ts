import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json, HttpError } from "@/lib/http";
import {
  DEFAULT_CATEGORIES,
  assertMember,
  familyIdsFor,
} from "@/lib/families";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Seeds the eight defaults for a scope that has none yet. */
async function seedIfEmpty(scope: { userId: string } | { familyId: string }) {
  const count = await prisma.category.count({ where: scope });
  if (count > 0) return;
  // skipDuplicates covers the race where two first-load requests seed at once;
  // the unique indexes are what make that safe.
  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((c) => ({ ...c, ...scope })),
    skipDuplicates: true,
  });
}

/**
 * The caller's own categories plus those of every family they belong to.
 *
 * `?scope=mine` or `?scope=<familyId>` narrows it, which is what the reminder form
 * uses so a family reminder can only be filed under that family's categories.
 */
export async function GET(req: NextRequest) {
  return json(async (user) => {
    const scope = req.nextUrl.searchParams.get("scope");

    if (scope && scope !== "mine") {
      await assertMember(user.id, scope);
      await seedIfEmpty({ familyId: scope });
      return prisma.category.findMany({
        where: { familyId: scope },
        orderBy: { name: "asc" },
      });
    }

    await seedIfEmpty({ userId: user.id });
    if (scope === "mine") {
      return prisma.category.findMany({
        where: { userId: user.id },
        orderBy: { name: "asc" },
      });
    }

    const familyIds = await familyIdsFor(user.id);
    return prisma.category.findMany({
      where: {
        OR: [
          { userId: user.id },
          ...(familyIds.length ? [{ familyId: { in: familyIds } }] : []),
        ],
      },
      include: { family: { select: { id: true, name: true } } },
      orderBy: [{ familyId: "asc" }, { name: "asc" }],
    });
  });
}

export async function POST(req: NextRequest) {
  return json(async (user) => {
    const body = await req.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) throw new HttpError(400, "Name is required");

    // A category belongs to exactly one scope: a person or a family.
    const familyId = body.familyId ? String(body.familyId) : null;
    if (familyId) await assertMember(user.id, familyId);
    const scope = familyId ? { familyId } : { userId: user.id };

    const clash = await prisma.category.findFirst({
      where: { ...scope, name },
      select: { id: true },
    });
    if (clash) {
      throw new HttpError(
        409,
        familyId
          ? "This family already has a category with that name."
          : "You already have a category with that name.",
      );
    }

    return prisma.category.create({
      data: { ...scope, name, icon: body.icon ?? null, color: body.color ?? null },
    });
  }, 201);
}
