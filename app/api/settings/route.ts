import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json, HttpError, type AuthUser, readJson } from "@/lib/http";
import { isPushConfigured, countSubscriptions } from "@/lib/push";
import { isMailConfigured } from "@/lib/mail";
import { hashPin, verifyPin, isValidPin, PIN_LENGTH } from "@/lib/pin";
import { IDLE_TIMEOUT_OPTIONS, type Settings } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The caller's own preferences, plus the read-only facts the Settings page needs
 * to explain delivery (are server keys present? how many of *my* devices are
 * reachable?).
 */
async function shape(userId: string): Promise<Settings> {
  const [u, passkeyCount, pushSubscriptions] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        role: true,
        accountType: true,
        timezone: true,
        defaultTime: true,
        overdueRepeatMins: true,
        idleTimeoutMins: true,
        emailOptIn: true,
        pushOptIn: true,
        password_hash: true,
      },
    }),
    prisma.passkey.count({ where: { userId } }),
    // Must match what the dispatcher will actually send to, so a revoked device
    // isn't reported as "receiving".
    countSubscriptions(userId),
  ]);

  const isAdmin = u.role === "admin";

  return {
    name: u.name,
    email: u.email,
    role: isAdmin ? "admin" : "member",
    accountType: u.accountType === "family" ? "family" : "solo",
    timezone: u.timezone,
    defaultTime: u.defaultTime,
    overdueRepeatMins: u.overdueRepeatMins,
    idleTimeoutMins: u.idleTimeoutMins,
    emailOptIn: u.emailOptIn,
    pushOptIn: u.pushOptIn,
    pinSet: Boolean(u.password_hash),
    passkeyCount,
    pushConfigured: isPushConfigured(),
    mailConfigured: isMailConfigured(),
    pushSubscriptions,
  };
}

export async function GET() {
  return json((user) => shape(user.id));
}

export async function PATCH(req: NextRequest) {
  return json(async (user: AuthUser) => {
    const body = await readJson(req);
    const data: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 2) throw new HttpError(400, "Enter your name.");
      data.name = name;
    }

    if (body.timezone !== undefined) {
      const tz = String(body.timezone);
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
      } catch {
        throw new HttpError(400, `Unknown timezone: ${tz}`);
      }
      data.timezone = tz;
    }

    if (body.defaultTime !== undefined) {
      const t = String(body.defaultTime);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) {
        throw new HttpError(400, "Default time must be HH:mm (24-hour).");
      }
      data.defaultTime = t;
    }

    if (body.overdueRepeatMins !== undefined) {
      const n = Number(body.overdueRepeatMins);
      if (!Number.isInteger(n) || n < 5 || n > 60 * 24) {
        throw new HttpError(
          400,
          "Overdue repeat must be between 5 minutes and 24 hours.",
        );
      }
      data.overdueRepeatMins = n;
    }

    if (body.idleTimeoutMins !== undefined) {
      const n = Number(body.idleTimeoutMins);
      const allowed = IDLE_TIMEOUT_OPTIONS.map((o) => o.minutes) as readonly number[];
      if (!allowed.includes(n)) {
        throw new HttpError(400, `Inactivity timeout must be one of: ${allowed.join(", ")}`);
      }
      data.idleTimeoutMins = n;
    }

    if (body.emailOptIn !== undefined) data.emailOptIn = Boolean(body.emailOptIn);
    if (body.pushOptIn !== undefined) data.pushOptIn = Boolean(body.pushOptIn);

    if (body.accountType !== undefined) {
      const next = body.accountType === "family" ? "family" : "solo";
      // Switching back to solo is refused while memberships exist: the family
      // surfaces would vanish from the UI while the person was still in a family,
      // still on its shared list, and still being notified about it.
      if (next === "solo") {
        const memberships = await prisma.familyMember.count({
          where: { userId: user.id },
        });
        if (memberships > 0) {
          throw new HttpError(
            409,
            "Leave your families first, then switch back to a single-person account.",
          );
        }
      }
      data.accountType = next;
    }

    // Changing the PIN requires the current one, so a borrowed session can't
    // lock the owner out of their own account.
    if (body.newPin !== undefined) {
      if (!isValidPin(body.newPin)) {
        throw new HttpError(400, `New PIN must be ${PIN_LENGTH} digits.`);
      }
      const current = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { password_hash: true },
      });
      if (current.password_hash) {
        if (!isValidPin(body.currentPin)) {
          throw new HttpError(400, "Enter your current PIN.");
        }
        if (!(await verifyPin(body.currentPin, current.password_hash))) {
          throw new HttpError(401, "Current PIN is incorrect.");
        }
      }
      data.password_hash = await hashPin(body.newPin);
    }

    if (Object.keys(data).length > 0) {
      await prisma.user.update({ where: { id: user.id }, data });
    }
    return shape(user.id);
  });
}
