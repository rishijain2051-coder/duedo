import { prisma } from "./db";
import { sendMail, isMailConfigured } from "./mail";

const DAY_MS = 24 * 60 * 60 * 1000;

interface DigestItem {
  title: string;
  category: string;
  amount: number | null;
  dueDate: Date;
  daysUntilDue: number;
}

export interface DispatchSummary {
  ran: boolean;
  smtpConfigured: boolean;
  remindersConsidered: number;
  usersNotified: number;
  emailsSent: number;
  notificationsCreated: number;
}

/**
 * Daily reminder engine (triggered by Vercel Cron). Finds active reminders due
 * within each member's window (or overdue), emails them a digest, and records one
 * notification per reminder per day so re-runs are idempotent.
 */
export async function dispatchDueReminders(): Promise<DispatchSummary> {
  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  const reminders = await prisma.reminder.findMany({
    where: { status: "active" },
    include: { category: true, assignedTo: true },
  });

  const notifiedToday = await prisma.notification.findMany({
    where: { createdAt: { gte: startOfToday }, reminderId: { not: null } },
    select: { reminderId: true },
  });
  const alreadyNotified = new Set(notifiedToday.map((n) => n.reminderId as string));

  const perUser = new Map<
    string,
    { user: (typeof reminders)[number]["assignedTo"]; items: DigestItem[]; ids: string[] }
  >();

  for (const r of reminders) {
    if (alreadyNotified.has(r.id)) continue;
    const dueMidnight = new Date(
      Date.UTC(r.dueDate.getUTCFullYear(), r.dueDate.getUTCMonth(), r.dueDate.getUTCDate()),
    );
    const daysUntilDue = Math.round((dueMidnight.getTime() - startOfToday.getTime()) / DAY_MS);
    const windowDays = r.assignedTo?.notifyDaysBefore ?? 3;
    if (daysUntilDue > windowDays) continue;

    const bucket = perUser.get(r.assignedToId) ?? { user: r.assignedTo, items: [], ids: [] };
    bucket.items.push({
      title: r.title,
      category: r.category?.name ?? "Uncategorized",
      amount: r.amount ?? null,
      dueDate: r.dueDate,
      daysUntilDue,
    });
    bucket.ids.push(r.id);
    perUser.set(r.assignedToId, bucket);
  }

  const smtpConfigured = isMailConfigured();
  let emailsSent = 0;
  let notificationsCreated = 0;
  let usersNotified = 0;

  for (const [userId, { user, items, ids }] of perUser) {
    if (items.length === 0) continue;
    usersNotified++;

    let channel = "in_app";
    if (user?.emailOptIn && user.email) {
      const { subject, html } = buildDigestEmail(user.name, items);
      const sent = await sendMail({ to: user.email, subject, html });
      if (sent) {
        emailsSent++;
        channel = "email";
      }
    }

    const rows = items.map((item, i) => ({
      userId,
      reminderId: ids[i],
      channel,
      message: buildInAppMessage(item),
    }));
    const created = await prisma.notification.createMany({ data: rows });
    notificationsCreated += created.count;
  }

  return {
    ran: true,
    smtpConfigured,
    remindersConsidered: reminders.length,
    usersNotified,
    emailsSent,
    notificationsCreated,
  };
}

function statusLabel(daysUntilDue: number): string {
  if (daysUntilDue < 0)
    return `Overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) === 1 ? "" : "s"}`;
  if (daysUntilDue === 0) return "Due today";
  if (daysUntilDue === 1) return "Due tomorrow";
  return `Due in ${daysUntilDue} days`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatAmount(amount: number | null): string {
  if (amount == null || amount === 0) return "";
  return `₹${amount.toLocaleString("en-IN")}`;
}

function buildInAppMessage(item: DigestItem): string {
  const amount = formatAmount(item.amount);
  return `${item.title} (${item.category}) — ${statusLabel(item.daysUntilDue)}${amount ? `, ${amount}` : ""}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDigestEmail(userName: string, items: DigestItem[]): { subject: string; html: string } {
  const appName = process.env.APP_NAME || "PRO-SYS";
  const sorted = [...items].sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  const overdue = sorted.filter((i) => i.daysUntilDue < 0).length;
  const subject =
    overdue > 0
      ? `⚠️ ${appName}: ${overdue} overdue + ${sorted.length - overdue} upcoming reminder${sorted.length === 1 ? "" : "s"}`
      : `${appName}: You have ${sorted.length} reminder${sorted.length === 1 ? "" : "s"} coming up`;

  const rows = sorted
    .map((i) => {
      const urgent = i.daysUntilDue < 0;
      const color = urgent ? "#dc2626" : i.daysUntilDue === 0 ? "#ea580c" : "#2563eb";
      const amount = formatAmount(i.amount);
      return `
        <tr>
          <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;font-weight:600;">${escapeHtml(i.title)}</td>
          <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${escapeHtml(i.category)}</td>
          <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(formatDate(i.dueDate))}</td>
          <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;">${amount || "—"}</td>
          <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;color:${color};font-weight:600;">${escapeHtml(statusLabel(i.daysUntilDue))}</td>
        </tr>`;
    })
    .join("");

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#111827;">
    <div style="background:linear-gradient(135deg,#2563eb,#1e40af);padding:24px;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;">${escapeHtml(appName)}</h1>
      <p style="margin:4px 0 0;color:#dbeafe;font-size:14px;">Your reminder digest</p>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
      <p style="margin-top:0;">Hi ${escapeHtml(userName)},</p>
      <p>Here's what needs your attention:</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="text-align:left;color:#6b7280;font-size:12px;text-transform:uppercase;">
            <th style="padding:8px;">Title</th><th style="padding:8px;">Category</th>
            <th style="padding:8px;">Due</th><th style="padding:8px;">Amount</th><th style="padding:8px;">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;

  return { subject, html };
}
