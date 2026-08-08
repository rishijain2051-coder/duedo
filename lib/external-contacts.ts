import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { escapeHtml } from "./html";
import { isMailConfigured, sendMail } from "./mail";

// Sending reminders to somebody who never signed up.
//
// A landlord, an accountant, a building secretary — the useful case for escalation is
// often a person outside the app entirely. That is also the case where a reminder app
// turns into an unsolicited-mail generator, so nothing goes out until the recipient has
// said yes.
//
// The consent step is not politeness. Every reminder this install sends leaves through one
// Gmail account; enough unconfirmed mail to strangers and Google throttles it, which takes
// out every reminder for every user. Asking first protects the delivery channel the whole
// app depends on.
//
// Token construction is lifted from lib/verify-email.ts, and for the same reason: the link
// is a bearer credential — whoever holds it decides whether this address can be written
// to — so it is CSPRNG-generated, stored only as an HMAC, compared in constant time, and
// single-use.

const TOKEN_BYTES = 32;

/**
 * Confirmation links don't expire.
 *
 * Unlike a signup link, there is nothing to re-request: the recipient isn't a user and has
 * no way to ask for another. An expiring link would strand them with a dead URL and no
 * route to either answer.
 */
function hashToken(token: string): string {
  return createHmac("sha256", process.env.AUTH_SECRET || "dev-insecure-secret-change-me")
    .update(token)
    .digest("hex");
}

function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export type ContactState = "confirmed" | "blocked" | "pending" | "invited" | "unavailable";

/**
 * Whether this contact may be written to, inviting them once if they've never been asked.
 *
 * Called from the dispatcher, so it must never throw and must be cheap on the common path.
 * Returns `confirmed` when the send may proceed; every other answer means it may not, and
 * `invited` means an invitation has just gone out instead of the alert.
 */
export async function contactSendable(
  contactId: string,
  context: { reminderTitle: string; requesterName: string },
): Promise<ContactState> {
  const contact = await prisma.externalContact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      email: true,
      label: true,
      confirmedAt: true,
      blockedAt: true,
      tokenHash: true,
      tokenSentAt: true,
    },
  });
  if (!contact) return "unavailable";
  if (contact.blockedAt) return "blocked";
  if (contact.confirmedAt) return "confirmed";
  // Already invited and waiting. Deliberately not re-sent: an invitation repeated every
  // hour by an overdue reminder is precisely the behaviour that gets a sender blocked.
  if (contact.tokenSentAt) return "pending";
  if (!isMailConfigured()) return "unavailable";

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  await prisma.externalContact.update({
    where: { id: contact.id },
    data: { tokenHash: hashToken(token), tokenSentAt: new Date() },
  });

  const appName = process.env.APP_NAME || "PRO-SYS";
  const base = `${appUrl()}/api/contacts/confirm?token=${encodeURIComponent(token)}`;
  const sent = await sendMail({
    to: contact.email,
    subject: `${context.requesterName} wants to send you reminders`,
    // Both interpolated values are typed by a user — an account name and a reminder
    // title — and this is the one email in the app that goes to somebody outside it.
    // Unescaped, a title was arbitrary HTML in a stranger's inbox, sent from this
    // install's own mail account and carrying its branding: a working phishing link
    // anybody with an account could address to anybody they liked.
    html: `
      <p>Hello,</p>
      <p><strong>${escapeHtml(context.requesterName)}</strong> uses ${escapeHtml(appName)} to keep
      track of things that are due, and has asked it to let you know when
      <em>${escapeHtml(context.reminderTitle)}</em> is overdue.</p>
      <p>Nothing has been sent to you yet, and nothing will be unless you say yes.</p>
      <p>
        <a href="${base}&answer=yes"
           style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;
                  border-radius:8px;text-decoration:none;font-weight:600">
          Yes, send them
        </a>
        &nbsp;&nbsp;
        <a href="${base}&answer=no"
           style="display:inline-block;padding:12px 20px;background:#e5e7eb;color:#111;
                  border-radius:8px;text-decoration:none;font-weight:600">
          No, never
        </a>
      </p>
      <p style="color:#666;font-size:13px">
        Choosing <strong>No</strong> blocks this address permanently — nobody using
        ${appName} will be able to add it again.
      </p>
    `,
  });

  // A failed send leaves tokenSentAt set, so it isn't retried on the next tick. The
  // address can be re-invited from the app once, deliberately, which is the right place
  // for that decision.
  return sent ? "invited" : "unavailable";
}

export type ConfirmOutcome =
  | { ok: true; answer: "yes" | "no"; email: string }
  | { ok: false; reason: "invalid" };

/**
 * Consumes a confirmation token.
 *
 * "No" is recorded as permanently blocked, and the unique index on (ownerId, email) plus
 * the blocked check in the add route mean nobody re-invites it. That is stronger than an
 * unsubscribe link, which typically only stops one sender.
 */
export async function confirmContact(
  token: string,
  answer: string,
): Promise<ConfirmOutcome> {
  if (!token || token.length < 16) return { ok: false, reason: "invalid" };
  const candidate = hashToken(token);
  const contact = await prisma.externalContact.findFirst({
    where: { tokenHash: candidate },
    select: { id: true, email: true, tokenHash: true },
  });
  if (!contact?.tokenHash || !hashesMatch(contact.tokenHash, candidate)) {
    return { ok: false, reason: "invalid" };
  }

  const said = answer === "no" ? "no" : "yes";
  await prisma.externalContact.update({
    where: { id: contact.id },
    data:
      said === "yes"
        ? { confirmedAt: new Date(), blockedAt: null, tokenHash: null }
        : { blockedAt: new Date(), confirmedAt: null, tokenHash: null },
  });
  return { ok: true, answer: said, email: contact.email };
}
