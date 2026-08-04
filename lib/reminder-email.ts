import { formatInZone, humanizeMinutes } from "./time";

// Email bodies for a single reminder alert.
//
// Kept apart from lib/mail.ts (the transport) and lib/dispatch.ts (the engine) so
// the templating can be read and changed without wading through either.

/**
 * `escalation` is the chain in lib/escalation.ts reaching past the assignee. It is an
 * AlertKind rather than a separate concept so it inherits the dedupe key, the notification
 * feed and the email template — see the note on Fire.offsetMin in lib/dispatch.ts.
 */
export type AlertKind = "lead" | "due" | "overdue" | "escalation";

export interface ReminderEmailInput {
  userName: string;
  title: string;
  description?: string | null;
  category?: string | null;
  amount?: number | null;
  dueAt: Date;
  timeZone: string;
  kind: AlertKind;
  /** Minutes until due — negative once overdue. */
  minutesUntilDue: number;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAmount(amount: number | null | undefined): string {
  if (amount == null || amount === 0) return "";
  return `₹${amount.toLocaleString("en-IN")}`;
}

function statusLabel(input: ReminderEmailInput): string {
  if (input.kind === "lead") {
    return `Due in ${humanizeMinutes(input.minutesUntilDue)}`;
  }
  if (input.kind === "due") return "Due now";
  if (input.kind === "escalation") {
    // Says why *this* person is being written to, which is the only thing separating an
    // escalation from a reminder they never asked for.
    return `Still not done after ${humanizeMinutes(-input.minutesUntilDue)}`;
  }
  return `Overdue by ${humanizeMinutes(-input.minutesUntilDue)}`;
}

function accentFor(kind: AlertKind): string {
  if (kind === "overdue" || kind === "escalation") return "#dc2626";
  if (kind === "due") return "#ea580c";
  return "#2563eb";
}

function row(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:8px 0;color:#6b7280;font-size:13px;width:120px;">${escapeHtml(label)}</td>
      <td style="padding:8px 0;font-size:14px;color:#111827;">${value}</td>
    </tr>`;
}

/** Subject + HTML for one reminder alert. */
export function buildReminderEmail(input: ReminderEmailInput): {
  subject: string;
  html: string;
} {
  const appName = process.env.APP_NAME || "PRO-SYS";
  const status = statusLabel(input);
  const accent = accentFor(input.kind);
  const amount = formatAmount(input.amount);
  const url = process.env.APP_URL?.replace(/\/$/, "");

  const subject =
    input.kind === "escalation"
      ? `${appName}: nobody has dealt with ${input.title}`
      : input.kind === "overdue"
        ? `⚠️ ${appName}: still due — ${input.title}`
        : input.kind === "due"
          ? `${appName}: due now — ${input.title}`
          : `${appName}: ${input.title} — ${status.toLowerCase()}`;

  const rows = [
    row("Status", `<strong style="color:${accent};">${escapeHtml(status)}</strong>`),
    row("Due", escapeHtml(formatInZone(input.dueAt, input.timeZone))),
    input.category ? row("Category", escapeHtml(input.category)) : "",
    amount ? row("Amount", escapeHtml(amount)) : "",
    input.description ? row("Notes", escapeHtml(input.description)) : "",
  ].join("");

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827;">
    <div style="background:linear-gradient(135deg,#2563eb,#1e40af);padding:24px;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;color:#ffffff;font-size:20px;">${escapeHtml(appName)}</h1>
      <p style="margin:4px 0 0;color:#dbeafe;font-size:14px;">${escapeHtml(status)}</p>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
      <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">Hi ${escapeHtml(input.userName)},</p>
      <h2 style="margin:0 0 16px;font-size:20px;line-height:1.3;">${escapeHtml(input.title)}</h2>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      ${
        url
          ? `<p style="margin:24px 0 0;">
               <a href="${escapeHtml(url)}/reminders"
                  style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;
                         padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;">
                 Open ${escapeHtml(appName)}
               </a>
             </p>`
          : ""
      }
      <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">
        You're getting this because email reminders are on for your account.
        Turn them off in Settings → Notifications.
      </p>
    </div>
  </div>`;

  return { subject, html };
}
