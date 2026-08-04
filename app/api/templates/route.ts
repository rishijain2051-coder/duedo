import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json } from "@/lib/http";
import { PACKS, findPack, resolveDueAt } from "@/lib/template-packs";
import { reminderScopeWhere, parseScope } from "@/lib/history-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The packs, with each item's date resolved and anything already imported marked.
 *
 * The preview this feeds is the whole reason import isn't one button. Twelve reminders
 * appearing unannounced is indistinguishable from a bug; a list with real dates and
 * amounts that the user can untick first is the same feature without the surprise.
 *
 * `?pack=` narrows to one. Without it, every pack comes back with its items, which is
 * what the picker needs.
 */
export async function GET(req: NextRequest) {
  return json(async (user) => {
    const scope = parseScope(req.nextUrl.searchParams.get("scope"));
    const only = req.nextUrl.searchParams.get("pack");

    // Membership check. Nothing here is secret, but the "already imported" flags below
    // read another list's reminders, and that isn't.
    const where = await reminderScopeWhere(user.id, scope);

    const existing = await prisma.reminder.findMany({
      where: { ...where, templateKey: { not: null } },
      select: { templateKey: true },
    });
    const have = new Set(existing.map((r) => r.templateKey));

    const now = new Date();
    const packs = (only ? PACKS.filter((p) => p.id === only) : PACKS).map((pack) => ({
      id: pack.id,
      name: pack.name,
      blurb: pack.blurb,
      items: pack.items.map((item) => {
        const { dueAt, placeholder } = resolveDueAt(
          item,
          now,
          user.timezone,
          user.defaultTime,
        );
        return {
          key: item.key,
          title: item.title,
          category: item.category,
          recurrence: item.recurrence,
          leadOffsets: item.leadOffsets,
          amount: item.amount ?? 0,
          note: item.note ?? null,
          dueAt,
          datePlaceholder: placeholder,
          alreadyImported: have.has(item.key),
        };
      }),
    }));

    return { scope, packs: only && packs.length === 0 ? [] : packs, unknownPack: Boolean(only && !findPack(only)) };
  });
}
