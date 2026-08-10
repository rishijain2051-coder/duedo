import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { escapeHtml } from "./html";
import { isMailConfigured, sendMail } from "./mail";
import { memberStats, orderMembers } from "./scoreboard";
import { zonedMonthStart, zonedMonthStartOffset } from "./time";

// The monthly summary to the family head.
//
// This exists because the switch for it already did. `Family.monthlyReportToHead` defaults
// to on, so every household was being promised an email that nothing sent — a setting that
// lies about what the app does is worse than no setting, and it is exactly the kind of gap
// nobody notices for months because the absence of an email looks like an empty month.
//
// It carries only what the family has switched on. Ranking and streaks are off by default,
// so by default this is assigned/completed/on-time counts in joining order. Otherwise the
// one message that arrives unasked would be the one containing the things you chose to
// hide.
//
// Rides the daily tick, guarded by an ActivityLog marker — the same trick the audit
// rotation uses, for the same reason: no second cron job, and the evidence that it ran
// lives where an admin would look for it.

const MARKER = "family.report";

export interface ReportResult {
  ran: boolean;
  families: number;
  sent: number;
  skipped: number;
}

/**
 * Mails last month's figures to each head who wants them, once per month.
 *
 * Never throws — this is housekeeping riding the reminder tick, and reminders matter more
 * than a summary being a day late. A failure for one family doesn't stop the rest.
 */
export async function sendMonthlyReports(
  now = new Date(),
  send: typeof sendMail | undefined = undefined,
  force = false,
): Promise<ReportResult> {
  const result: ReportResult = { ran: false, families: 0, sent: 0, skipped: 0 };
  if (!isMailConfigured()) return result;

  // Only in the first days of a month, unless forced. A report for "last month" has
  // nothing new to say on the 20th, and this saves a per-family query on most ticks.
  const dayOfMonth = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", day: "numeric" }).format(now),
  );
  if (!force && dayOfMonth > 3) return result;

  const deliver = send ?? sendMail;
  const families = await prisma.family.findMany({
    where: { monthlyReportToHead: true },
    select: {
      id: true,
      name: true,
      showRanking: true,
      showStreaks: true,
      members: {
        where: { role: "head" },
        select: { user: { select: { id: true, name: true, email: true, timezone: true, status: true } } },
      },
    },
  });

  result.ran = true;
  result.families = families.length;

  for (const family of families) {
    try {
      const head = family.members[0]?.user;
      // A family with no active head has nobody to report to. Not an error: headship can
      // be vacant briefly while it is handed over.
      if (!head || head.status !== "active") {
        result.skipped++;
        continue;
      }

      const start = zonedMonthStartOffset(now, head.timezone, -1);
      const end = zonedMonthStart(now, head.timezone);

      // One marker per family per month, so a second tick the same day — or the same
      // month — sends nothing. Keyed on the month's start rather than "today", so a
      // rotation that clears the log mid-month can't cause a second send.
      const already = await prisma.activityLog.findFirst({
        where: { action: MARKER, entity: "family", entityId: family.id, timestamp: { gte: end } },
        select: { id: true },
      });
      if (already) {
        result.skipped++;
        continue;
      }

      const rows = orderMembers(
        await memberStats(family.id, start, end, end),
        family.showRanking,
      );

      // Nothing was assigned to anyone all month. Marked as done so it isn't reconsidered,
      // but not sent: a report saying "nobody was given anything" is not worth an email.
      if (rows.every((r) => r.assigned === 0)) {
        await mark(family.id, { sent: false, reason: "nothing assigned" });
        result.skipped++;
        continue;
      }

      const monthName = new Intl.DateTimeFormat("en-GB", {
        timeZone: head.timezone,
        month: "long",
        year: "numeric",
      }).format(start);

      const appName = process.env.APP_NAME || "DueDo";
      const url = process.env.APP_URL?.replace(/\/$/, "");

      const cells = rows
        .map(
          (r) => `
          <tr>
            <td style="padding:8px 0;font-size:14px;">${escapeHtml(r.name)}</td>
            <td style="padding:8px 0;font-size:14px;text-align:right;">
              ${r.assigned === 0 ? "—" : `${r.completed}/${r.assigned}`}
            </td>
            <td style="padding:8px 0;font-size:14px;text-align:right;color:#6b7280;">
              ${r.assigned === 0 ? "" : `${r.onTime} on time`}
            </td>
            ${
              family.showStreaks
                ? `<td style="padding:8px 0;font-size:14px;text-align:right;color:#6b7280;">
                     ${r.streakMonths > 0 ? `${r.streakMonths}m streak` : ""}
                   </td>`
                : ""
            }
          </tr>`,
        )
        .join("");

      const sent = await deliver({
        to: head.email,
        subject: `${appName}: ${family.name} in ${monthName}`,
        html: `
          <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#111827;">
            <h2 style="margin:0 0 4px;font-size:18px;">${escapeHtml(family.name)}</h2>
            <p style="margin:0 0 16px;color:#6b7280;font-size:13px;">${escapeHtml(monthName)}</p>
            <table style="width:100%;border-collapse:collapse;">${cells}</table>
            ${
              url
                ? `<p style="margin:20px 0 0;">
                     <a href="${url}/settings" style="display:inline-block;background:#2563eb;color:#fff;
                        text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;">
                       Open ${escapeHtml(appName)}
                     </a>
                   </p>`
                : ""
            }
            <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">
              You get this because you're the head of ${escapeHtml(family.name)}. Turn it off
              in Settings &rarr; Families.
            </p>
          </div>`,
      });

      // Marked either way. A mail failure here is not worth retrying every tick for the
      // rest of the month, and unlike the audit rotation nothing is deleted on the strength
      // of it — the figures stay in the app.
      await mark(family.id, { sent, to: head.email, month: start.toISOString() });
      if (sent) result.sent++;
      else result.skipped++;
    } catch (e) {
      console.error(`[report] family ${family.id} failed:`, (e as Error).message);
    }
  }

  return result;
}

function mark(familyId: string, detail: Prisma.InputJsonValue) {
  return prisma.activityLog.create({
    data: { action: MARKER, entity: "family", entityId: familyId, detail },
  });
}
