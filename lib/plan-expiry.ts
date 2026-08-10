import { prisma } from "./db";
import { audit } from "./audit";
import { mainAdmin } from "./audit-rotate";
import { escapeHtml } from "./html";
import { isMailConfigured, sendMail } from "./mail";
import { PLANS, effectivePlan, isPlanId } from "./plan";
import { toDateKey } from "./format";

// Renewal warnings, on the same tick as everything else.
//
// This only exists because access is a date rather than a boolean. Nobody can be told
// their plan is about to end if the only thing on record is that it hasn't. It is also
// the honest half of a manual payment system: there is no card to auto-charge, so
// somebody has to be told to pay again, and if that somebody is the owner relying on
// memory then people lose access without warning and blame the app.
//
// Two audiences, deliberately different channels:
//
//   * the account, as an in-app notification — the feed and the badge they already
//     watch. No email: several accounts about to lapse means several sends, and the
//     one thing worse than an unnoticed expiry is a mail loop about one;
//   * the owner, as one email listing everyone due, because they are the only person
//     who can act on it and they are not sitting in the app waiting.
//
// Nothing here can stop a reminder firing. It writes a row and sends one mail.

/** How far ahead to look. Long enough to pay, short enough to still feel current. */
export const WARN_DAYS = 3;

const DAY_MS = 86_400_000;

export interface ExpiryResult {
  ran: boolean;
  reason?: string;
  /** Accounts warned on this tick. Zero on all but a few ticks a year. */
  warned?: number;
  /** Whether the owner's digest went out, and to whom. */
  mailedTo?: string;
}

/**
 * Warns anyone whose access ends within WARN_DAYS, once per grant.
 *
 * The "already warned" guard is an ActivityLog entry per account rather than a column,
 * matching audit.rotate and family.report. It is scoped to the last WARN_DAYS + 1 days,
 * which is what makes it per *grant* and not per account forever: renew for a year and
 * the next warning falls outside the window, so it fires again on time. Extend by two
 * days after a warning and it stays quiet, which is the right answer — they have been
 * told, and telling them twice for the same expiry is nagging.
 */
export async function warnExpiringPlans(
  now = new Date(),
  /** Injectable purely so a test can assert without mailing the real owner. */
  send: typeof sendMail | undefined = undefined,
): Promise<ExpiryResult> {
  const horizon = new Date(now.getTime() + WARN_DAYS * DAY_MS);

  const due = await prisma.user.findMany({
    where: {
      status: "active",
      plan: { not: "free" },
      premiumUntil: { gt: now, lte: horizon },
      // Admins are on the top plan regardless of the date, so theirs running out
      // changes nothing. Warning them would be a renewal notice for access they are
      // not going to lose.
      role: { not: "admin" },
    },
    select: { id: true, name: true, email: true, plan: true, premiumUntil: true, timezone: true },
    orderBy: { premiumUntil: "asc" },
  });

  if (due.length === 0) return { ran: true, warned: 0 };

  const guardFrom = new Date(now.getTime() - (WARN_DAYS + 1) * DAY_MS);
  const alreadyWarned = await prisma.activityLog.findMany({
    where: {
      action: "plan.expiring",
      entityId: { in: due.map((u) => u.id) },
      timestamp: { gte: guardFrom },
    },
    select: { entityId: true },
  });
  const warnedIds = new Set(alreadyWarned.map((a) => a.entityId));

  const fresh = due.filter((u) => !warnedIds.has(u.id));
  if (fresh.length === 0) return { ran: true, warned: 0, reason: "all already warned" };

  for (const u of fresh) {
    const until = u.premiumUntil!;
    const days = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / DAY_MS));
    const planName = isPlanId(u.plan) ? PLANS[u.plan].name : u.plan;

    await prisma.notification.create({
      data: {
        userId: u.id,
        title: `Your ${planName} plan ends in ${days} day${days === 1 ? "" : "s"}`,
        // Says what actually happens, because the honest answer is reassuring and the
        // imagined one is not. People assume a lapse deletes things.
        body:
          `Ends ${toDateKey(until, u.timezone)}. Everything you've made stays, and every ` +
          `reminder keeps firing — you'd lose email reminders, spending and voice. ` +
          `Open Plans to renew.`,
        kind: "due",
      },
    });

    // Written before the mail below, and per account. The digest is a convenience for
    // the owner; the guard is what stops an account being told the same thing every
    // minute for three days, so it must not depend on a send succeeding.
    await audit({
      actorId: null,
      action: "plan.expiring",
      entity: "user",
      entityId: u.id,
      detail: { plan: u.plan, until: until.toISOString(), daysLeft: days },
    });
  }

  const admin = await mainAdmin();
  if (!admin) return { ran: true, warned: fresh.length, reason: "no admin to notify" };
  if (!isMailConfigured() && !send) {
    return { ran: true, warned: fresh.length, reason: "SMTP is not configured" };
  }

  const deliver = send ?? sendMail;
  const appName = process.env.APP_NAME || "DueDo";
  const rows = fresh
    .map(
      (u) =>
        `<tr><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.email)}</td>` +
        `<td>${escapeHtml(isPlanId(u.plan) ? PLANS[u.plan].name : u.plan)}</td>` +
        `<td>${escapeHtml(toDateKey(u.premiumUntil!, admin.timezone))}</td></tr>`,
    )
    .join("");

  const ok = await deliver({
    to: admin.email,
    subject: `${appName} — ${fresh.length} plan${fresh.length === 1 ? "" : "s"} ending within ${WARN_DAYS} days`,
    html: `
      <p>These accounts lose paid access soon. They have each been told in the app.</p>
      <table cellpadding="6" style="border-collapse:collapse">
        <tr><th align="left">Name</th><th align="left">Email</th><th align="left">Plan</th><th align="left">Ends</th></tr>
        ${rows}
      </table>
      <p>Extend under Admin &rarr; Accounts &rarr; Plan once payment arrives. Nothing
      of theirs is deleted if it lapses; they drop to the free limits and keep every
      reminder they have.</p>
    `,
  });

  return { ran: true, warned: fresh.length, mailedTo: ok ? admin.email : undefined };
}

/**
 * Whether an account is inside its warning window — for the banner in the UI, which
 * has the same rule to apply and no business re-deriving it.
 */
export function isExpiringSoon(
  user: { plan: string; premiumUntil: Date | string | null },
  now = new Date(),
): boolean {
  if (effectivePlan(user, now) === "free") return false;
  const until = new Date(user.premiumUntil!).getTime();
  return until - now.getTime() <= WARN_DAYS * DAY_MS;
}
