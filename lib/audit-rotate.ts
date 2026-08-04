import { prisma } from "./db";
import { sendMail, isMailConfigured } from "./mail";
import { zonedDayBounds } from "./time";
import { toDateKey } from "./format";

// Daily rotation of the audit log: mail the day's entries to the owning admin, then
// trim the live log back to a short tail.
//
// The log is a running record of who did what to whom, and it only grows — 188 rows
// appeared in this install's first day of testing alone. Left alone it becomes both
// the largest table in the database and unreadable, which defeats the point of
// having it. Rotating keeps the live log short enough to actually scan while the
// history survives as a file the admin holds.
//
// The rule that matters: **nothing is deleted until the email has been accepted by
// the SMTP server.** A failed send leaves the rows exactly where they were, to be
// carried into the next attempt. Losing an audit trail to a transient mail error
// would be worse than letting it grow.

/** One dump is capped so a runaway log can't build a mail nobody can receive. */
const MAX_ROWS_PER_DUMP = 20_000;

/**
 * How many of the newest entries survive the trim.
 *
 * Clearing to nothing was the first version, and it left the audit page blank for
 * most of the day — which reads as "nothing is being recorded" rather than "it was
 * filed this morning". A tail keeps the page answering the question people actually
 * open it with, *what just happened*, at a cost of a few kB; the archive in the
 * mailbox is still the complete record either way.
 */
export const AUDIT_TAIL_KEEP = 50;

export interface RotationResult {
  ran: boolean;
  reason?: string;
  rowsMailed?: number;
  rowsDeleted?: number;
  /** Entries left in the live log. `rowsMailed - rowsDeleted`, stated rather than implied. */
  keptTail?: number;
  truncated?: boolean;
  mailedTo?: string;
}

/**
 * The account the dump goes to: the install's owner, the account holding
 * `isRootAdmin`. That is the one admin no other admin can demote or delete, so it is
 * the only stable answer to "whose install is this?". Falls back to the
 * earliest-created active admin, which is all there is to go on if the flag was never
 * set — a fresh install someone forgot to mark.
 */
async function mainAdmin() {
  return prisma.user.findFirst({
    where: { role: "admin", status: "active" },
    orderBy: [{ isRootAdmin: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, email: true, timezone: true },
  });
}

/** RFC 4180: quote everything, double any embedded quote. Cheap and unambiguous. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Rotates the log if it hasn't been rotated yet today, in the admin's own timezone.
 *
 * The "already done today" marker is an `audit.rotate` row written after the trim, so
 * the log carries a line saying what happened to the older entries and where they
 * went. That avoids a separate table purely to hold one timestamp, and it means the
 * evidence of the rotation lives in the thing being rotated rather than somewhere an
 * admin would have to know to look.
 */
export async function rotateAuditLogIfDue(
  now = new Date(),
  /**
   * The sender, injectable purely so the "a failed send deletes nothing" guarantee
   * can be tested. It is the one rule this whole function exists to uphold, and
   * there is no other way to exercise it — provoking a real SMTP failure means
   * relying on a server to reject something, which is not dependable: an address at
   * a reserved `.invalid` domain gets *accepted* at submission and bounces later,
   * so a test built on that deletes the log while appearing to prove it wouldn't.
   */
  send: typeof sendMail | undefined = undefined,
): Promise<RotationResult> {
  const deliver = send ?? sendMail;
  const admin = await mainAdmin();
  if (!admin) return { ran: false, reason: "no active admin to send the dump to" };
  if (!isMailConfigured()) return { ran: false, reason: "SMTP is not configured" };

  // "Today" means the admin's calendar day, so the reset lands at their midnight
  // rather than UTC's. zonedDayBounds already resolves that instant correctly across
  // DST, which is not worth re-deriving here.
  const { start: localMidnight } = zonedDayBounds(now, admin.timezone);

  const alreadyToday = await prisma.activityLog.findFirst({
    where: { action: "audit.rotate", timestamp: { gte: localMidnight } },
    select: { id: true },
  });
  if (alreadyToday) return { ran: false, reason: "already rotated today" };

  // Only entries from before this rotation started, so anything written while the
  // mail is in flight survives into tomorrow's dump rather than being deleted unseen.
  const cutoff = now;
  const rows = await prisma.activityLog.findMany({
    where: { timestamp: { lt: cutoff } },
    orderBy: { timestamp: "asc" },
    take: MAX_ROWS_PER_DUMP,
    include: { actor: { select: { name: true, email: true } } },
  });

  if (rows.length === 0) {
    // Nothing to mail, but still mark the day so this doesn't re-check every minute.
    await prisma.activityLog.create({
      data: {
        action: "audit.rotate",
        entity: "audit",
        detail: { rowsMailed: 0, note: "log was already empty" },
      },
    });
    return { ran: true, rowsMailed: 0, rowsDeleted: 0, mailedTo: admin.email };
  }

  const truncated = rows.length === MAX_ROWS_PER_DUMP;
  const header = "timestamp,actor,actor_email,action,entity,entity_id,detail";
  const csv = [
    header,
    ...rows.map((r) =>
      [
        r.timestamp.toISOString(),
        r.actor?.name ?? "system",
        r.actor?.email ?? "",
        r.action,
        r.entity,
        r.entityId ?? "",
        r.detail,
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\r\n");

  const dateLabel = toDateKey(now, admin.timezone);
  const appName = process.env.APP_NAME || "PRO-SYS";

  const sent = await deliver({
    to: admin.email,
    subject: `${appName} audit log — ${rows.length} entries up to ${dateLabel}`,
    html: `
      <p>Attached is the ${appName} audit log, ${rows.length} entr${rows.length === 1 ? "y" : "ies"}
      up to ${cutoff.toISOString()}.</p>
      ${truncated ? `<p><strong>Capped at ${MAX_ROWS_PER_DUMP} rows.</strong> The rest stay in the log and will come in the next dump.</p>` : ""}
      <p>The live log has been trimmed to its most recent ${AUDIT_TAIL_KEEP} entries, so
      this file is the only complete copy — keep it if you need the history.</p>
    `,
    attachments: [
      {
        filename: `audit-${dateLabel}.csv`,
        content: csv,
        contentType: "text/csv; charset=utf-8",
      },
    ],
  });

  if (!sent) {
    // Deliberately nothing deleted. The next run tries again with these rows plus
    // whatever has happened since.
    return {
      ran: false,
      reason: "the dump could not be emailed, so nothing was cleared",
      rowsMailed: 0,
    };
  }

  // Everything was mailed; only the older part is removed. `rows` is ascending, so
  // the tail to keep is its end. When the dump hit the cap, delete all of it — the
  // newest 50 of the oldest 20,000 are not the newest 50 of the log, and the entries
  // left outside the cap will supply the tail on their own.
  const trimTo = truncated ? rows.length : Math.max(0, rows.length - AUDIT_TAIL_KEEP);
  const ids = rows.slice(0, trimTo).map((r) => r.id);
  const deleted =
    ids.length > 0
      ? await prisma.activityLog.deleteMany({ where: { id: { in: ids } } })
      : { count: 0 };

  await prisma.activityLog.create({
    data: {
      action: "audit.rotate",
      entity: "audit",
      detail: {
        rowsMailed: rows.length,
        rowsDeleted: deleted.count,
        keptTail: rows.length - deleted.count,
        mailedTo: admin.email,
        upTo: cutoff.toISOString(),
        ...(truncated ? { truncated: true } : {}),
      },
    },
  });

  return {
    ran: true,
    rowsMailed: rows.length,
    rowsDeleted: deleted.count,
    keptTail: rows.length - deleted.count,
    truncated,
    mailedTo: admin.email,
  };
}
