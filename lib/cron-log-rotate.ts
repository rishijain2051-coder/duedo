import { prisma } from "./db";
import { mainAdmin } from "./audit-rotate";
import { toCsv } from "./csv";
import { sendMail, isMailConfigured } from "./mail";
import { formatInZone, zonedDayBounds } from "./time";
import { toDateKey } from "./format";

// Daily rotation of pg_cron's own run log, on exactly the same terms as the audit log:
// mail the older entries to the owner, then trim.
//
// pg_cron writes one row to cron.job_run_details per job run and never removes one. At
// a run a minute that is 1,440 rows a day forever, whether or not anybody uses the app.
// Measured on this install: 695 kB a day, 248 MB a year — twice the size of the whole
// application schema, and enough on its own to fill a 500 MB tier in about two years
// with no users at all.
//
// A plain scheduled DELETE would have bounded it, and did for a day. Keeping a day and
// mailing the rest is better for the reason the audit log works that way: the history
// is the thing you want on the morning something turns out to have been failing for a
// week, and by then a silent prune has already thrown it away.
//
// The rule that matters, inherited verbatim: **nothing is deleted until the email has
// been accepted by the SMTP server.** A failed send leaves every row where it was, to
// be carried into the next attempt.
//
// This is the one part of the app that reads outside its own schema. It works because
// the connection is the database owner; if that ever stops being true the failure is
// caught and reported rather than thrown, and the log simply keeps growing until
// somebody notices — which is the same position as before this existed.

/** One dump is capped so a runaway log can't build a mail nobody can receive. */
const MAX_ROWS_PER_DUMP = 20_000;

/** How much stays behind. A day is what "did last night's ticks run?" needs. */
export const CRON_LOG_KEEP_HOURS = 24;

export interface CronRotationResult {
  ran: boolean;
  reason?: string;
  rowsMailed?: number;
  rowsDeleted?: number;
  truncated?: boolean;
  mailedTo?: string;
}

interface RunRow {
  runid: string;
  jobid: string;
  jobname: string | null;
  status: string | null;
  return_message: string | null;
  start_time: Date | null;
  end_time: Date | null;
}

/**
 * Rotates the run log if it hasn't been rotated yet today, in the owner's timezone.
 *
 * The once-a-day marker is a `cron.rotate` row in ActivityLog, the same trick
 * rotateAuditLogIfDue uses — it avoids a table holding one timestamp, and it means the
 * evidence that this ran lands in the log an admin already reads.
 */
export async function rotateCronLogIfDue(
  now = new Date(),
  /** Injectable purely so "a failed send deletes nothing" can be tested. */
  send: typeof sendMail | undefined = undefined,
  /** Skips the once-a-day check and nothing else. Dev-only; the route refuses it. */
  force = false,
): Promise<CronRotationResult> {
  const deliver = send ?? sendMail;
  const admin = await mainAdmin();
  if (!admin) return { ran: false, reason: "no active admin to send the dump to" };
  if (!isMailConfigured()) return { ran: false, reason: "SMTP is not configured" };

  const { start: localMidnight } = zonedDayBounds(now, admin.timezone);
  const alreadyToday = force
    ? null
    : await prisma.activityLog.findFirst({
        where: { action: "cron.rotate", timestamp: { gte: localMidnight } },
        select: { id: true },
      });
  if (alreadyToday) return { ran: false, reason: "already rotated today" };

  const cutoff = new Date(now.getTime() - CRON_LOG_KEEP_HOURS * 3600_000);

  let rows: RunRow[];
  try {
    // Raw SQL because this table is not in the Prisma schema — it belongs to pg_cron,
    // and adding it would make `prisma db push` believe it owns it.
    rows = await prisma.$queryRawUnsafe<RunRow[]>(
      `select d.runid::text as runid, d.jobid::text as jobid, j.jobname,
              d.status, d.return_message, d.start_time, d.end_time
         from cron.job_run_details d
         left join cron.job j on j.jobid = d.jobid
        where d.end_time < $1
        order by d.end_time asc
        limit ${MAX_ROWS_PER_DUMP}`,
      cutoff,
    );
  } catch (err) {
    // No access to the cron schema, or no pg_cron at all. Not fatal to anything: the
    // log keeps growing, which is where it was before this existed.
    return { ran: false, reason: `could not read cron.job_run_details: ${(err as Error).message}` };
  }

  if (rows.length === 0) {
    await prisma.activityLog.create({
      data: {
        action: "cron.rotate",
        entity: "system",
        detail: { rowsMailed: 0, note: "nothing older than the keep window" },
      },
    });
    return { ran: true, rowsMailed: 0, rowsDeleted: 0, mailedTo: admin.email };
  }

  const truncated = rows.length === MAX_ROWS_PER_DUMP;
  const csv = toCsv(
    ["runid", "jobid", "jobname", "status", "return_message", "start_time", "end_time"],
    rows.map((r) => [
      r.runid,
      r.jobid,
      r.jobname ?? "",
      r.status ?? "",
      r.return_message ?? "",
      r.start_time?.toISOString() ?? "",
      r.end_time?.toISOString() ?? "",
    ]),
  );

  // Worth stating in the mail rather than leaving to be counted: a run that did not
  // succeed is the only reason to open this file.
  const failed = rows.filter((r) => r.status !== "succeeded").length;
  // dd/mm/yyyy for the human, ISO for the filename — see the same split in
  // lib/audit-rotate.ts. A slash is a path separator, so the two cannot be one value.
  const fileDate = toDateKey(now, admin.timezone);
  const readDate = formatInZone(now, admin.timezone, false);
  const appName = process.env.APP_NAME || "DueDo";

  const sent = await deliver({
    to: admin.email,
    subject: `${appName} scheduler log — ${rows.length} runs up to ${readDate}${failed ? ` (${failed} not succeeded)` : ""}`,
    html: `
      <p>Attached is pg_cron's run history, ${rows.length} run${rows.length === 1 ? "" : "s"}
      up to ${cutoff.toISOString()}.</p>
      <p><strong>${failed}</strong> did not report success.</p>
      ${truncated ? `<p><strong>Capped at ${MAX_ROWS_PER_DUMP} rows.</strong> The rest stay and will come in the next dump.</p>` : ""}
      <p>The live table keeps the last ${CRON_LOG_KEEP_HOURS} hours, so this file is the
      only complete copy — keep it if you need the history. Postgres writes one of these
      rows every minute and never removes any; unbounded it reaches about 248 MB a year.</p>
    `,
    attachments: [
      {
        filename: `scheduler-${fileDate}.csv`,
        content: csv,
        contentType: "text/csv; charset=utf-8",
      },
    ],
  });

  if (!sent) {
    return {
      ran: false,
      reason: "the dump could not be emailed, so nothing was cleared",
      rowsMailed: 0,
    };
  }

  // Delete exactly what was mailed, by id, rather than re-running the time predicate —
  // a row written between the read and here would otherwise be deleted unseen.
  let deleted = 0;
  try {
    const ids = rows.map((r) => r.runid).join(",");
    const res = await prisma.$executeRawUnsafe(
      `delete from cron.job_run_details where runid in (${ids})`,
    );
    deleted = Number(res);
  } catch (err) {
    return {
      ran: false,
      reason: `mailed but could not delete: ${(err as Error).message}`,
      rowsMailed: rows.length,
    };
  }

  await prisma.activityLog.create({
    data: {
      action: "cron.rotate",
      entity: "system",
      detail: {
        rowsMailed: rows.length,
        rowsDeleted: deleted,
        notSucceeded: failed,
        mailedTo: admin.email,
        upTo: cutoff.toISOString(),
        ...(truncated ? { truncated: true } : {}),
      },
    },
  });

  return {
    ran: true,
    rowsMailed: rows.length,
    rowsDeleted: deleted,
    truncated,
    mailedTo: admin.email,
  };
}
