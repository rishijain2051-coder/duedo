import { json, HttpError } from "@/lib/http";
import { isMailConfigured, isUndeliverable } from "@/lib/mail";
import { sendTestEmail } from "@/lib/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Emails the caller so they can confirm delivery works.
 *
 * Always sends to the address on their own account — never to an arbitrary
 * address from the request body, which would turn this into an open relay for
 * anyone with a login.
 */
export async function POST() {
  return json(async (user) => {
    if (!isMailConfigured()) {
      throw new HttpError(
        503,
        "Email is not configured on the server — set SMTP_HOST, SMTP_USER and SMTP_PASS.",
      );
    }
    // Checked before sending, because the mailer refuses these outright and returns the
    // same `false` a genuine failure does — which had this route telling anyone on an
    // @example.com address to go and debug perfectly good SMTP credentials.
    if (isUndeliverable(user.email)) {
      throw new HttpError(
        400,
        `${user.email} is a reserved address that can never receive mail. Change the address on your account to test delivery.`,
      );
    }
    const sent = await sendTestEmail(user.email, user.name);
    if (!sent) {
      throw new HttpError(
        502,
        "The server could not send the email. Check the SMTP credentials and the server logs.",
      );
    }
    return { sent, to: user.email, message: `Test email sent to ${user.email}.` };
  });
}
