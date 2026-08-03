import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  readToken,
  signToken,
} from "./session";

// Session lifecycle. Node-only (node:crypto + prisma) — import from route
// handlers only.
//
// Sessions are DB-backed rather than purely stateless so they can be listed and
// revoked. The cost is a lookup per authenticated request; the benefit is that
// "sign out this device", the inactivity timeout, and an admin suspending an
// account can actually be enforced instead of merely honoured by a cooperating
// client.

/** lastSeenAt is only rewritten this often, to keep idle traffic off the DB. */
const TOUCH_INTERVAL_MS = 60_000;

/** The fields every protected route needs about its caller. */
const AUTH_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  accountType: true,
  timezone: true,
  defaultTime: true,
  overdueRepeatMins: true,
  idleTimeoutMins: true,
  emailOptIn: true,
  pushOptIn: true,
} as const;

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  accountType: string;
  timezone: string;
  defaultTime: string;
  overdueRepeatMins: number;
  idleTimeoutMins: number;
  emailOptIn: boolean;
  pushOptIn: boolean;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Best-effort friendly name from the User-Agent, for the sessions list. */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "Unknown device";
  // Order matters: Chrome and Edge both claim Safari, Edge also claims Chrome.
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /CriOS|Chrome/.test(ua)
      ? "Chrome"
      : /Firefox/.test(ua)
        ? "Firefox"
        : /Safari/.test(ua)
          ? "Safari"
          : "";
  return browser ? `${device} · ${browser}` : device;
}

export interface CreatedSession {
  id: string;
  token: string;
}

/** Registers a new login for `userId` and returns the cookie value for it. */
export async function createSession(
  userId: string,
  userAgent: string | null,
): Promise<CreatedSession> {
  const id = crypto.randomUUID();
  const token = await signToken(id);
  await prisma.session.create({
    data: {
      id,
      userId,
      tokenHash: hashToken(token),
      label: describeUserAgent(userAgent),
      userAgent: userAgent?.slice(0, 400) ?? null,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    },
  });
  return { id, token };
}

export interface ActiveSession {
  id: string;
  label: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  user: AuthUser;
}

/**
 * Resolves the request's cookie to a live session, or null.
 *
 * Also the enforcement point for expiry, inactivity and account status: a session
 * past either limit — or belonging to an account an admin has not approved (or
 * has since rejected) — is dropped here, so the next request is simply
 * unauthenticated.
 */
export async function resolveSession(): Promise<ActiveSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const sessionId = await readToken(token);
  if (!sessionId) return null;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: { select: AUTH_USER_SELECT } },
  });
  if (!session) return null; // revoked, or from a previous AUTH_SECRET

  // Guards against a forged id paired with a valid-looking signature.
  if (session.tokenHash !== hashToken(token)) return null;

  const now = Date.now();

  if (session.expiresAt.getTime() <= now) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  // An account that is no longer approved loses its live logins too, otherwise
  // rejecting someone would only stop them signing in *again*.
  if (session.user.status !== "active") {
    await prisma.session.deleteMany({ where: { userId: session.userId } });
    return null;
  }

  const idleTimeoutMins = session.user.idleTimeoutMins;
  if (idleTimeoutMins > 0) {
    const idleFor = now - session.lastSeenAt.getTime();
    if (idleFor > idleTimeoutMins * 60_000) {
      await prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }
  }

  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } })
      .catch(() => {
        /* revoked mid-request; the next one will 401 */
      });
  }

  return {
    id: session.id,
    label: session.label,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    user: session.user,
  };
}

/**
 * Revokes one login. Scoped to `userId` so a signed-in user can only ever end
 * their own sessions, never somebody else's.
 */
export async function destroySessionById(
  id: string,
  userId: string,
): Promise<number> {
  const res = await prisma.session.deleteMany({ where: { id, userId } });
  return res.count;
}

/** Ends the session belonging to the current request. */
export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return;
  const sessionId = await readToken(token);
  if (sessionId) await prisma.session.deleteMany({ where: { id: sessionId } });
}

export async function listSessions(userId: string) {
  // Expired rows are pruned lazily here rather than by a scheduled job.
  await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return prisma.session.findMany({
    where: { userId },
    select: { id: true, label: true, createdAt: true, lastSeenAt: true },
    orderBy: { lastSeenAt: "desc" },
  });
}

/** Signs out every other login for this user, keeping `keepId`. */
export async function revokeOtherSessions(
  userId: string,
  keepId: string,
): Promise<number> {
  const res = await prisma.session.deleteMany({
    where: { userId, id: { not: keepId } },
  });
  return res.count;
}
