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

function daysUntil(dueDate: Date, startOfToday: Date): number {
  const dueMidnight = new Date(
    Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate()),
  );
  return Math.round((dueMidnight.getTime() - startOfToday.getTime()) / DAY_MS);
}

/**
 * Daily reminder engine (Vercel Cron). Emails each reminder ONCE — when it is due
 * (or the first run on/after its due date) — never repeatedly day after day.
 * A reminder re-arms after completion because its due date rolls forward.
 */
export async function dispatchDueReminders(): Promise<DispatchSummary> {
  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  // Only reminders that are actually due or overdue (nothing in advance).
  const reminders = await prisma.reminder.findMany({
    where: { status: "active", dueDate: { lte: now } },
    include: { category: true, assignedTo: true },
  });

  // For each reminder, find the newest notification already sent for it.
  const ids = reminders.map((r) => r.id);
  const priorNotifs = ids.length
    ? await prisma.notification.findMany({
        where: { reminderId: { in: ids } },
        select: { reminderId: true, createdAt: true },
      })
    : [];
  const latestNotif = new Map<string, Date>();
  for (const n of priorNotifs) {
    const rid = n.reminderId as string;
    const cur = latestNotif.get(rid);
    if (!cur || n.createdAt > cur) latestNotif.set(rid, n.createdAt);
  }

  const perUser = new Map<
    string,
    { user: (typeof reminders)[number]["assignedTo"]; items: DigestItem[]; ids: string[] }
  >();

  for (const r of reminders) {
    // Already notified for this due-cycle? (notification created on/after this due date)
    const last = latestNotif.get(r.id);
    if (last && last >= r.dueDate) continue;

    const bucket = perUser.get(r.assignedToId) ?? { user: r.assignedTo, items: [], ids: [] };
    bucket.items.push({
      title: r.title,
      category: r.category?.name ?? "Uncategorized",
      amount: r.amount ?? null,
      dueDate: r.dueDate,
      daysUntilDue: daysUntil(r.dueDate, startOfToday),
    });
    bucket.ids.push(r.id);
    perUser.set(r.assignedToId, bucket);
  }

  const smtpConfigured = isMailConfigured();
  let emailsSent = 0;
  let notificationsCreated = 0;
  let usersNotified = 0;

  for (const [userId, { user, items, ids: rids }] of perUser) {
    if (items.length === 0) continue;
    usersNotified++;

    let channel = "in_app";
    if (user?.emailOptIn && user.email) {
      const { subject, html } = buildDigestEmail(user.name, items);
      if (await sendMail({ to: user.email, subject, html })) {
        emailsSent++;
        channel = "email";
      }
    }

    const rows = items.map((item, i) => ({
      userId,
      reminderId: rids[i],
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

/**
 * On-demand: email the WHOLE family about a single reminder right now, and drop an
 * in-app notification for each member. Triggered by the "Notify family" button.
 */
export async function notifyFamilyAboutReminder(reminderId: string) {
  const reminder = await prisma.reminder.findUnique({
    where: { id: reminderId },
    include: { category: true },
  });
  if (!reminder) return null;

  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const item: DigestItem = {
    title: reminder.title,
    category: reminder.category?.name ?? "Uncategorized",
    amount: reminder.amount ?? null,
    dueDate: reminder.dueDate,
    daysUntilDue: daysUntil(reminder.dueDate, startOfToday),
  };

  const members = await prisma.user.findMany();
  let emailed = 0;

  for (const m of members) {
    let channel = "in_app";
    if (m.emailOptIn && m.email) {
      const { subject, html } = buildFamilyEmail(m.name, item);
      if (await sendMail({ to: m.email, subject, html })) {
        emailed++;
        channel = "email";
      }
    }
    await prisma.notification.create({
      data: {
        userId: m.id,
        reminderId,
        channel,
        message: `👨‍👩‍👧 Family reminder: ${buildInAppMessage(item)}`,
      },
    });
  }

  return { emailed, notified: members.length, title: reminder.title };
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

function emailShell(appName: string, heading: string, greeting: string, rowsHtml: string): string {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#111827;">
    <div style="background:linear-gradient(135deg,#2563eb,#1e40af);padding:24px;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;">${escapeHtml(appName)}</h1>
      <p style="margin:4px 0 0;color:#dbeafe;font-size:14px;">${escapeHtml(heading)}</p>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
      <p style="margin-top:0;">${escapeHtml(greeting)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="text-align:left;color:#6b7280;font-size:12px;text-transform:uppercase;">
            <th style="padding:8px;">Title</th><th style="padding:8px;">Category</th>
            <th style="padding:8px;">Due</th><th style="padding:8px;">Amount</th><th style="padding:8px;">Status</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  </div>`;
}

function itemRow(i: DigestItem): string {
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
}

function buildDigestEmail(userName: string, items: DigestItem[]): { subject: string; html: string } {
  const appName = process.env.APP_NAME || "PRO-SYS";
  const sorted = [...items].sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  const overdue = sorted.filter((i) => i.daysUntilDue < 0).length;
  const subject =
    overdue > 0
      ? `⚠️ ${appName}: ${sorted.length} reminder${sorted.length === 1 ? "" : "s"} due now`
      : `${appName}: ${sorted.length} reminder${sorted.length === 1 ? "" : "s"} due`;
  const html = emailShell(
    appName,
    "Reminder due",
    `Hi ${userName}, this is due:`,
    sorted.map(itemRow).join(""),
  );
  return { subject, html };
}

function buildFamilyEmail(userName: string, item: DigestItem): { subject: string; html: string } {
  const appName = process.env.APP_NAME || "PRO-SYS";
  const subject = `${appName}: Family reminder — ${item.title}`;
  const html = emailShell(
    appName,
    "Family reminder",
    `Hi ${userName}, someone flagged this for the whole family:`,
    itemRow(item),
  );
  return { subject, html };
}
