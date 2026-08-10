import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import type { AuthUser } from "./auth";

// The credential a phone shortcut carries.
//
// Same construction as lib/verify-email.ts and lib/external-contacts.ts, and for the
// same reason: it is a bearer token, so whoever holds it can act. CSPRNG-generated,
// stored only as an HMAC, compared in constant time.
//
// Two things make it a smaller risk than those, and both are deliberate:
//
//   * it opens exactly one endpoint, POST /api/ingest/reminder. It cannot read a
//     reminder, cannot sign in, cannot reach anything under /api/admin. Losing it means
//     somebody can add reminders to your list — noisy, visible, and undoable — rather
//     than read a household's movements;
//   * there is one per account. Generating a new one invalidates the old, so "revoke"
//     and "replace" are the same action and there is no list to audit.
//
// It never expires. A shortcut sitting on a Home Screen that stops working silently
// three months later is worse than one that keeps working: nobody would connect the
// failure to an expiry, and the reminders would simply stop being captured.

const TOKEN_BYTES = 32;

/**
 * Prefixed so a leaked string is recognisable for what it is in a log or a paste.
 *
 * Changing it does not invalidate anything already issued: the stored hash covers the
 * whole token, and verification never inspects the prefix. Tokens minted before the
 * rename keep their `prosys_` and keep working — this only shapes new ones.
 */
const PREFIX = "duedo_";

function hashToken(token: string): string {
  return createHmac(
    "sha256",
    process.env.AUTH_SECRET || "dev-insecure-secret-change-me",
  )
    .update(token)
    .digest("hex");
}

function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Issues a token for `userId`, replacing any previous one, and returns it.
 *
 * The only time the plain value exists. It is shown once and never recoverable — the
 * row holds a hash, so "show it to me again" is not a feature that can be added later
 * without weakening the storage.
 */
export async function mintApiToken(userId: string): Promise<string> {
  const token = PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
  await prisma.user.update({
    where: { id: userId },
    data: {
      apiTokenHash: hashToken(token),
      apiTokenCreatedAt: new Date(),
      apiTokenLastUsedAt: null,
    },
  });
  return token;
}

export async function revokeApiToken(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { apiTokenHash: null, apiTokenCreatedAt: null, apiTokenLastUsedAt: null },
  });
}

/** What Settings shows about the token without being able to show the token. */
export async function apiTokenStatus(
  userId: string,
): Promise<{ exists: boolean; createdAt: Date | null; lastUsedAt: Date | null }> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { apiTokenHash: true, apiTokenCreatedAt: true, apiTokenLastUsedAt: true },
  });
  return {
    exists: Boolean(row?.apiTokenHash),
    createdAt: row?.apiTokenCreatedAt ?? null,
    lastUsedAt: row?.apiTokenLastUsedAt ?? null,
  };
}

/**
 * The account a token belongs to, or null.
 *
 * Narrowed by hash in the database and then compared in constant time — the second
 * compare is what stops the timing of the index lookup being useful. A suspended or
 * unapproved account is refused here, so revoking an account also silences its
 * shortcut without anyone having to remember the token exists.
 */
export async function userForApiToken(token: string): Promise<AuthUser | null> {
  if (!token || token.length < 16) return null;
  const candidate = hashToken(token);
  const user = await prisma.user.findFirst({
    where: { apiTokenHash: candidate, status: "active" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isRootAdmin: true,
      status: true,
      accountType: true,
      // The ingest route enforces the same reminder cap the UI does, so the caller it
      // builds has to carry the same billing fields a session caller does. Leaving
      // these out is exactly how a paywall gets bypassed by the one door that doesn't
      // go through the form.
      plan: true,
      premiumUntil: true,
      timezone: true,
      defaultTime: true,
      overdueRepeatMins: true,
      idleTimeoutMins: true,
      emailOptIn: true,
      pushOptIn: true,
      apiTokenHash: true,
    },
  });
  if (!user?.apiTokenHash || !hashesMatch(user.apiTokenHash, candidate)) return null;

  // Best-effort: it answers "is the shortcut actually being used?" on the Settings
  // page, and is never worth failing a capture over.
  void prisma.user
    .update({ where: { id: user.id }, data: { apiTokenLastUsedAt: new Date() } })
    .catch(() => {});

  // The hash was selected only to compare against; it must not travel with the caller.
  const rest = { ...user } as Partial<typeof user>;
  delete rest.apiTokenHash;
  return rest as AuthUser;
}

/** `Authorization: Bearer <token>`, or the `token` field of the body. */
export function bearerFrom(header: string | null): string {
  if (!header) return "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : "";
}
