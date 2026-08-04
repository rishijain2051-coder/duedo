import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  const port = Number(process.env.SMTP_PORT ?? 465);
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === "true"
    : port === 465;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return transporter;
}

export function isMailConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
  );
}

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Files to attach. Used by the daily audit dump, which sends a CSV. */
  attachments?: { filename: string; content: string | Buffer; contentType?: string }[];
}

/**
 * Domains reserved by RFC 2606 / RFC 6761 as guaranteed never to exist.
 *
 * Delivery to these always fails, but it fails *asynchronously*: the SMTP server
 * accepts the message at submission and bounces it minutes later. So `sendMail`
 * reports success, the caller believes the mail was delivered, and the bounce lands in
 * the sending account's own inbox.
 *
 * That is not hypothetical. The daily audit rotation deletes the log only once the
 * mail is accepted — and a test that addressed the dump to an `.invalid` recipient,
 * expecting a rejection, got an acceptance instead and destroyed a real audit log.
 * Refusing here turns "accepted then bounced" into an immediate, visible false, which
 * is what every caller already handles.
 */
const UNDELIVERABLE = /(^|\.)(invalid|test|localhost|example)$|(^|@)example\.(com|net|org)$/i;

function isUndeliverable(address: string): boolean {
  const domain = address.split("@")[1]?.trim().toLowerCase();
  return !domain || UNDELIVERABLE.test(domain);
}

/** Sends one email. Returns true on success, false if skipped/failed (never throws). */
export async function sendMail(options: SendMailOptions): Promise<boolean> {
  if (isUndeliverable(options.to)) {
    console.warn(
      `[mail] refusing ${options.to}: reserved domain that cannot receive mail`,
    );
    return false;
  }
  const t = getTransporter();
  if (!t) return false;
  const from =
    process.env.MAIL_FROM ||
    `${process.env.APP_NAME || "PRO-SYS"} <${process.env.SMTP_USER}>`;
  try {
    await t.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text ?? options.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      ...(options.attachments ? { attachments: options.attachments } : {}),
    });
    return true;
  } catch (err) {
    console.error(`[mail] failed to send to ${options.to}:`, (err as Error).message);
    return false;
  }
}
