import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/http";
import { toCsv } from "@/lib/csv";
import { round2 } from "@/lib/money";
import { formatInZone, zonedMonthStartOffset } from "@/lib/time";
import { historyScopeWhere, parseScope } from "@/lib/history-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One download can't be unbounded; three months of detail is far below this anyway. */
const MAX_ROWS = 20_000;

/**
 * One row per completion, as CSV.
 *
 * Built directly rather than through `json()` because the body is a file, not JSON — the
 * helper would wrap it. Auth is therefore done by hand, and this is the only route in the
 * app where forgetting that would be silent, so it is the first thing in the function.
 *
 * Covers the retained detail window only. Older months exist as monthly summaries, which
 * `/api/insights/year` serves — a per-payment list of them no longer exists to export.
 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const p = req.nextUrl.searchParams;
  const scope = parseScope(p.get("scope"));

  let where;
  try {
    where = await historyScopeWhere(user.id, scope);
  } catch {
    // historyScopeWhere throws a 404 for a family the caller isn't in. Mirrored here
    // rather than leaked as a 500, and still a 404 rather than a 403 — see lib/ownership.
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  const now = new Date();
  const from = parseDate(p.get("from")) ?? zonedMonthStartOffset(now, user.timezone, -3);
  const to = parseDate(p.get("to")) ?? now;

  const rows = await prisma.reminderHistory.findMany({
    where: { ...where, completedOn: { gte: from, lte: to } },
    orderBy: { completedOn: "desc" },
    take: MAX_ROWS,
    select: {
      completedOn: true,
      cycleDueAt: true,
      amount: true,
      remarks: true,
      completedBy: { select: { name: true } },
      reminder: {
        select: {
          title: true,
          category: { select: { name: true } },
          family: { select: { name: true } },
        },
      },
    },
  });

  const csv = toCsv(
    ["completed_on", "due_on", "on_time", "title", "category", "list", "amount", "completed_by", "remarks"],
    rows.map((r) => [
      formatInZone(r.completedOn, user.timezone),
      r.cycleDueAt ? formatInZone(r.cycleDueAt, user.timezone) : "",
      // Blank, not "no", when the cycle was never recorded. Guessing here would turn
      // "unknown" into an accusation.
      r.cycleDueAt ? (r.completedOn <= r.cycleDueAt ? "yes" : "no") : "",
      r.reminder?.title ?? "(deleted reminder)",
      r.reminder?.category?.name ?? "",
      r.reminder?.family?.name ?? "Personal",
      round2(r.amount ?? 0),
      r.completedBy?.name ?? "",
      r.remarks ?? "",
    ]),
  );

  // Stated in the file itself, because a total that looks short needs a visible reason:
  // deleting a reminder takes its payment history with it, by design.
  const note =
    `"Covers reminders currently in the app. Deleting a reminder removes its history, ` +
    `so anything deleted is not counted here."`;

  const name = `prosys-${scope === "mine" ? "personal" : "family"}-${formatInZone(from, user.timezone).replace(/\s/g, "")}.csv`;

  return new NextResponse(`${note}\r\n${csv}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** A rubbish `from`/`to` falls back to the default window rather than 500ing. */
function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
