import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json, readJson } from "@/lib/http";
import { audit } from "@/lib/audit";
import { findPack, resolveDueAt, validLeadOffsets } from "@/lib/template-packs";
import { parseScope, reminderScopeWhere } from "@/lib/history-scope";
import { assertMember } from "@/lib/families";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A pack is a dozen items; anything larger is a client bug, not a big request. */
const MAX_ITEMS = 50;

/**
 * Creates the reminders from a pack.
 *
 * Two properties make this safe to press twice:
 *
 *   * every created reminder carries its `templateKey`, and a key already present in this
 *     scope is skipped — so a double tap, a retry, or a second import six months later
 *     adds only what is missing;
 *   * categories are matched by name and created only when absent, so importing two packs
 *     that both want "Insurance" doesn't produce two of them.
 *
 * One transaction, because half an imported pack is worse than none: the user would have
 * to work out which of twelve reminders they now have.
 */
export async function POST(req: NextRequest) {
  return json(async (user) => {
    const body = await readJson(req);
    const scope = parseScope(typeof body.scope === "string" ? body.scope : "mine");
    const pack = findPack(body.pack);
    if (!pack) throw new HttpError(400, "No such pack.");

    // Membership, and — separately — the right to *write* to that list. reminderScopeWhere
    // proves the caller can see the scope; assertMember is what says they may add to it.
    const where = await reminderScopeWhere(user.id, scope);
    const familyId = scope === "mine" ? null : scope;
    if (familyId) await assertMember(user.id, familyId);

    // An explicit subset, or the whole pack. Unticking items in the preview is the point,
    // so the list the client sends wins over the pack's contents.
    const wanted =
      Array.isArray(body.keys) && body.keys.length > 0
        ? pack.items.filter((i) => (body.keys as unknown[]).includes(i.key))
        : pack.items;
    if (wanted.length === 0) throw new HttpError(400, "Nothing selected to import.");
    if (wanted.length > MAX_ITEMS) throw new HttpError(400, "Too many items at once.");

    const already = await prisma.reminder.findMany({
      where: { ...where, templateKey: { in: wanted.map((i) => i.key) } },
      select: { templateKey: true },
    });
    const have = new Set(already.map((r) => r.templateKey));
    const toCreate = wanted.filter((i) => !have.has(i.key));

    if (toCreate.length === 0) {
      return { created: 0, skipped: wanted.length, categoriesCreated: 0 };
    }

    const now = new Date();
    let categoriesCreated = 0;

    const created = await prisma.$transaction(async (tx) => {
      // Existing categories in this scope, by name. Case-insensitive: someone who already
      // has "insurance" should not end up with "Insurance" beside it.
      const cats = await tx.category.findMany({
        where: familyId ? { familyId } : { userId: user.id, familyId: null },
        select: { id: true, name: true },
      });
      const byName = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));

      for (const name of new Set(toCreate.map((i) => i.category))) {
        if (byName.has(name.toLowerCase())) continue;
        const cat = await tx.category.create({
          data: familyId ? { familyId, name } : { userId: user.id, name },
          select: { id: true, name: true },
        });
        byName.set(cat.name.toLowerCase(), cat.id);
        categoriesCreated++;
      }

      const rows = toCreate.map((item) => {
        const { dueAt } = resolveDueAt(item, now, user.timezone, user.defaultTime);
        return {
          userId: user.id,
          familyId,
          categoryId: byName.get(item.category.toLowerCase())!,
          title: item.title,
          description: item.note ?? null,
          dueAt,
          hasTime: false,
          leadOffsets: validLeadOffsets(item.leadOffsets),
          recurrenceRule: item.recurrence,
          amount: item.amount ?? 0,
          // Shared items land addressed to the whole family: a pack is a household's
          // paperwork, and quietly making the importer the only recipient would mean
          // nobody else hears about the electricity bill.
          audience: familyId ? "family" : "owner",
          templateKey: item.key,
          status: "active",
        };
      });

      // skipDuplicates guards the race where two devices import the same pack at once.
      // There is no unique index on templateKey to lean on, so this is belt-and-braces
      // rather than the mechanism — the check above is.
      const result = await tx.reminder.createMany({ data: rows, skipDuplicates: true });
      return result.count;
    });

    await audit({
      actorId: user.id,
      action: "template.import",
      entity: familyId ? "family" : "user",
      entityId: familyId ?? user.id,
      detail: { pack: pack.id, created, skipped: wanted.length - toCreate.length },
    });

    return {
      created,
      skipped: wanted.length - toCreate.length,
      categoriesCreated,
    };
  }, 201);
}
