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
}

/** Sends one email. Returns true on success, false if skipped/failed (never throws). */
export async function sendMail(options: SendMailOptions): Promise<boolean> {
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
    });
    return true;
  } catch (err) {
    console.error(`[mail] failed to send to ${options.to}:`, (err as Error).message);
    return false;
  }
}
