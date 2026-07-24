import { NextRequest } from "next/server";
import { json } from "@/lib/http";
import { isMailConfigured, sendMail } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return json(async () => {
    const body = await req.json().catch(() => ({}));
    const to = body?.to || process.env.SMTP_USER;
    if (!isMailConfigured()) {
      return {
        sent: false,
        message: "SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS.",
      };
    }
    if (!to) return { sent: false, message: "No recipient address provided." };
    const sent = await sendMail({
      to,
      subject: `${process.env.APP_NAME || "PRO-SYS"}: test email`,
      html: "<p>✅ Your PRO-SYS email settings are working correctly.</p>",
    });
    return {
      sent,
      to,
      message: sent
        ? "Test email sent. Check your inbox (and spam folder)."
        : "SMTP is configured but the send failed. Check the server logs.",
    };
  });
}
