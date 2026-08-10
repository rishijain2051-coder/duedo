import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { escapeHtml } from "./html";
import { sendMail, isMailConfigured } from "./mail";

// Email verification, which is what activates a self-registered account.
//
// It replaced admin approval. Approval asked an admin to make a judgement they had no
// basis for — a name and an address they had never seen — and in the meantime the
// person who signed up sat at a screen saying "wait for an admin" with no idea who
// that was or how long it would take. Proving you can read the address you typed is
// both a real check and one the person can complete themselves.
//
// The token is a bearer credential: whoever holds it activates that account. So it is
// generated with the CSPRNG, stored only as an HMAC, compared in constant time, and
// expires. Requesting a new one invalidates the previous.

/** Long enough that guessing is hopeless; short enough to sit in a URL. */
const TOKEN_BYTES = 32;

/**
 * How long a link stays good. A day covers "I'll do it tonight" without leaving a
 * working key to an unclaimed account lying in an inbox indefinitely.
 */
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Same construction as the session cookie, so both rest on AUTH_SECRET. */
function hashToken(token: string): string {
  return createHmac(
    "sha256",
    process.env.AUTH_SECRET || "dev-insecure-secret-change-me",
  )
    .update(token)
    .digest("hex");
}

/** Constant-time compare, so response timing can't be used to narrow a guess. */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export interface VerificationResult {
  sent: boolean;
  /** Present only when mail is unavailable, so the caller can say what to do next. */
  reason?: string;
}

/**
 * Issues a fresh token and emails the link. Safe to call repeatedly — each call
 * replaces the previous token, so an older link stops working.
 */
export async function sendVerificationEmail(user: {
  id: string;
  name: string;
  email: string;
}): Promise<VerificationResult> {
  if (!isMailConfigured()) {
    return { sent: false, reason: "email is not configured on this install" };
  }
  // Reasons read as a clause after "could not be sent", so they say the cause and
  // not the outcome — the caller has already stated that.

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  await prisma.user.update({
    where: { id: user.id },
    data: { verifyTokenHash: hashToken(token), verifyTokenSentAt: new Date() },
  });

  const link = `${appUrl()}/api/auth/verify?token=${encodeURIComponent(token)}`;
  const appName = process.env.APP_NAME || "DueDo";

  const sent = await sendMail({
    to: user.email,
    subject: `Confirm your email for ${appName}`,
    html: `
      <p>Hi ${escapeHtml(user.name)},</p>
      <p>Confirm this address to finish setting up your ${escapeHtml(appName)} account:</p>
      <p><a href="${link}"
            style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;
                   border-radius:8px;text-decoration:none;font-weight:600">
        Confirm my email
      </a></p>
      <p style="color:#666;font-size:13px">
        Or paste this into your browser:<br>
        <span style="word-break:break-all">${link}</span>
      </p>
      <p style="color:#666;font-size:13px">
        The link works for 24 hours. If you didn't sign up, ignore this — the account
        stays locked and nothing else happens.
      </p>
    `,
  });

  if (!sent) {
    // The token stays on the row. Harmless — it can't be used by anyone who never
    // received it, and a resend will replace it.
    return { sent: false, reason: "the mail server rejected the address" };
  }
  return { sent: true };
}

export type VerifyOutcome =
  | { ok: true; alreadyVerified: boolean; email: string }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Consumes a token and activates the account.
 *
 * Candidates are narrowed by hash in the database, then compared in constant time —
 * the extra compare is what stops a timing signal from the index lookup being useful.
 * A used token is cleared, so a link in a forwarded email is spent.
 */
export async function verifyEmailToken(token: string): Promise<VerifyOutcome> {
  if (!token || token.length < 16) return { ok: false, reason: "invalid" };

  const candidateHash = hashToken(token);
  const user = await prisma.user.findFirst({
    where: { verifyTokenHash: candidateHash },
    select: {
      id: true,
      email: true,
      status: true,
      emailVerifiedAt: true,
      verifyTokenHash: true,
      verifyTokenSentAt: true,
    },
  });

  if (!user?.verifyTokenHash || !hashesMatch(user.verifyTokenHash, candidateHash)) {
    return { ok: false, reason: "invalid" };
  }

  const sentAt = user.verifyTokenSentAt?.getTime() ?? 0;
  if (Date.now() - sentAt > VERIFY_TOKEN_TTL_MS) {
    // Left on the row rather than cleared, so "expired" stays distinguishable from
    // "never existed" and the resend page can say something useful.
    return { ok: false, reason: "expired" };
  }

  const alreadyVerified = user.emailVerifiedAt !== null;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      verifyTokenHash: null,
      verifyTokenSentAt: null,
      // Verification activates the account — but never *re*-activates one an admin
      // rejected. Otherwise an old link in an inbox would undo a moderation decision.
      ...(user.status === "pending"
        ? { status: "active", approvedAt: new Date() }
        : {}),
    },
  });

  return { ok: true, alreadyVerified, email: user.email };
}
