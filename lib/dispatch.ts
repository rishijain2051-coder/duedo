import { prisma } from "./db";
import {
  sendPushToUser,
  countOutstanding,
  countSubscriptions,
  isPushConfigured,
} from "./push";
import { sendMail, isMailConfigured } from "./mail";
import { buildReminderEmail, type AlertKind } from "./reminder-email";
import { formatInZone, formatTimeInZone, humanizeMinutes } from "./time";

// The reminder engine. Called once a minute by Supabase pg_cron (see DEPLOY.md),
// which is why every decision below has to be idempotent: a duplicated or delayed
// cron tick must not produce a duplicate notification.
//
// Reminders are private, so everything fans out per owner: their timezone, their
// overdue interval, their devices, their inbox, their channel preferences.

const MS_PER_MIN = 60_000;

/**
 * Floor on how often an *overdue* reminder may be emailed, regardless of how
 * short the owner's nag interval is.
 *
 * Push nags are collapsible — a new one replaces the last on the lock screen — so
 * hourly is fine there. An inbox has no such thing, and hourly mail about the
 * same unpaid bill is how people start ignoring the app. Lead and due-time
 * emails are never throttled; only the repeats are.
 */
const EMAIL_OVERDUE_MIN_GAP_MINS = 12 * 60;

interface ReminderOwner {
  id: string;
  name: string;
  email: string;
  timezone: string;
  overdueRepeatMins: number;
  emailOptIn: boolean;
  pushOptIn: boolean;
}

interface ReminderRow {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  dueAt: Date;
  leadOffsets: number[];
  amount: number | null;
  createdAt: Date;
  lastNaggedAt: Date | null;
  lastEmailedAt: Date | null;
  snoozedUntil: Date | null;
  user: ReminderOwner;
  category: { name: string } | null;
}

interface Fire {
  reminder: ReminderRow;
  kind: AlertKind;
  /** lead: the offset in minutes. due: 0. overdue: whole minutes since dueAt. */
  offsetMin: number;
  /** Minutes until due — negative once overdue. */
  minutesUntilDue: number;
}

export interface DispatchSummary {
  ran: boolean;
  pushConfigured: boolean;
  mailConfigured: boolean;
  /** Devices reachable across every approved account. */
  subscriptions: number;
  usersConsidered: number;
  considered: number;
  fired: Record<AlertKind, number>;
  skippedAlreadySent: number;
  notificationsCreated: number;
  pushesSent: number;
  pushesFailed: number;
  pushesSkippedOptOut: number;
  emailsSent: number;
  emailsThrottled: number;
  emailsSkippedOptOut: number;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "P2002";
}

/**
 * Works out everything that should fire for one reminder at `now`.
 *
 * Lead alerts are deliberately not back-filled: a lead point that already lay in
 * the past when the reminder was created is skipped, so adding "1 week before" to
 * something due tomorrow doesn't fire instantly.
 */
function planFires(r: ReminderRow, now: Date, overdueRepeatMins: number): Fire[] {
  const fires: Fire[] = [];
  const dueMs = r.dueAt.getTime();
  const nowMs = now.getTime();
  const minutesUntilDue = Math.round((dueMs - nowMs) / MS_PER_MIN);
  const isDue = dueMs <= nowMs;

  if (!isDue) {
    for (const offset of r.leadOffsets) {
      const at = dueMs - offset * MS_PER_MIN;
      if (at > nowMs) continue; // still in the future
      if (at < r.createdAt.getTime()) continue; // already past at creation — don't back-fill
      fires.push({ reminder: r, kind: "lead", offsetMin: offset, minutesUntilDue });
    }
    return fires;
  }

  // Due or overdue. The due alert always goes out exactly once per due-cycle.
  fires.push({ reminder: r, kind: "due", offsetMin: 0, minutesUntilDue });

  // Then keep nagging on an interval until the reminder is completed or snoozed.
  // Baseline is the last nag, or the due instant itself for the first one, so the
  // first nag lands one full interval after the due alert rather than alongside it.
  const baseline = (r.lastNaggedAt ?? r.dueAt).getTime();
  if (nowMs - baseline >= overdueRepeatMins * MS_PER_MIN) {
    const slot = Math.floor((nowMs - dueMs) / MS_PER_MIN);
    if (slot > 0) {
      fires.push({ reminder: r, kind: "overdue", offsetMin: slot, minutesUntilDue });
    }
  }

  return fires;
}

function buildCopy(fire: Fire, timeZone: string): { title: string; body: string } {
  const { reminder: r, kind, minutesUntilDue } = fire;
  const amount =
    r.amount && r.amount > 0 ? ` · ₹${r.amount.toLocaleString("en-IN")}` : "";
  const category = r.category?.name ? ` (${r.category.name})` : "";

  if (kind === "lead") {
    return {
      title: r.title,
      body: `Due in ${humanizeMinutes(minutesUntilDue)} — ${formatInZone(r.dueAt, timeZone)}${amount}`,
    };
  }
  if (kind === "due") {
    return {
      title: `Due now: ${r.title}`,
      body: `${formatTimeInZone(r.dueAt, timeZone)}${category}${amount}`,
    };
  }
  return {
    title: `Still due: ${r.title}`,
    body: `Overdue by ${humanizeMinutes(-minutesUntilDue)} — was due ${formatInZone(r.dueAt, timeZone)}${amount}`,
  };
}

export async function dispatchDueReminders(
  now: Date = new Date(),
): Promise<DispatchSummary> {
  // One query for every candidate across every account. The owner is joined in
  // because each fire needs their zone, nag interval and channel choices — going
  // back per reminder would be a query each.
  const reminders = (await prisma.reminder.findMany({
    where: {
      status: "active",
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      // Pending and rejected accounts are dormant: no alerts until an admin
      // approves them.
      user: { status: "active" },
    },
    select: {
      id: true,
      userId: true,
      title: true,
      description: true,
      dueAt: true,
      leadOffsets: true,
      amount: true,
      createdAt: true,
      lastNaggedAt: true,
      lastEmailedAt: true,
      snoozedUntil: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          timezone: true,
          overdueRepeatMins: true,
          emailOptIn: true,
          pushOptIn: true,
        },
      },
      category: { select: { name: true } },
    },
  })) as ReminderRow[];

  const summary: DispatchSummary = {
    ran: true,
    pushConfigured: isPushConfigured(),
    mailConfigured: isMailConfigured(),
    // Counted up front, not derived from a send. Otherwise an idle run reports
    // "subscriptions: 0" and reads as "no device enrolled" when devices are fine.
    subscriptions: await prisma.pushSubscription.count({
      where: { blockedAt: null, user: { status: "active" } },
    }),
    usersConsidered: new Set(reminders.map((r) => r.userId)).size,
    considered: reminders.length,
    fired: { lead: 0, due: 0, overdue: 0 },
    skippedAlreadySent: 0,
    notificationsCreated: 0,
    pushesSent: 0,
    pushesFailed: 0,
    pushesSkippedOptOut: 0,
    emailsSent: 0,
    emailsThrottled: 0,
    emailsSkippedOptOut: 0,
  };

  const plan = reminders.flatMap((r) =>
    planFires(r, now, r.user.overdueRepeatMins),
  );

  // planFires works from one snapshot, so a reminder can legitimately produce a
  // `due` and an `overdue` fire in the same run (that's how a missed cron catches
  // up). This keeps the email throttle honest across both.
  const lastEmailAt = new Map<string, number>();
  for (const r of reminders) {
    if (r.lastEmailedAt) lastEmailAt.set(r.id, r.lastEmailedAt.getTime());
  }

  for (const fire of plan) {
    const { reminder: r, kind, offsetMin } = fire;
    const owner = r.user;

    // Claim the slot BEFORE sending. The unique index on
    // (reminderId, cycleDueAt, kind, offsetMin) is what makes a repeated or
    // overlapping cron tick a no-op instead of a second notification.
    try {
      await prisma.reminderDispatch.create({
        data: { reminderId: r.id, cycleDueAt: r.dueAt, kind, offsetMin },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        summary.skippedAlreadySent++;
        continue;
      }
      throw err;
    }

    summary.fired[kind]++;
    const { title, body } = buildCopy(fire, owner.timezone);

    // The in-app feed records every alert regardless of channel, so nothing is
    // lost when a push fails or email is off.
    await prisma.notification.create({
      data: { userId: owner.id, reminderId: r.id, title, body, kind },
    });
    summary.notificationsCreated++;

    const reminderUpdate: { lastNaggedAt?: Date; lastEmailedAt?: Date } = {};
    if (kind !== "lead") reminderUpdate.lastNaggedAt = now;

    // ------------------------------------------------------------------ push
    if (!owner.pushOptIn) {
      summary.pushesSkippedOptOut++;
    } else {
      const badge = await countOutstanding(owner.id, now);
      const result = await sendPushToUser(owner.id, {
        title,
        body,
        // One tag per reminder, so a nag replaces the previous notification for
        // the same thing instead of stacking a wall of them on the lock screen.
        tag: `reminder-${r.id}`,
        reminderId: r.id,
        kind,
        badge,
        url: "/reminders",
      });

      summary.pushesSent += result.sent;
      summary.pushesFailed += result.failed;

      if (result.sent === 0 && result.subscriptions > 0) {
        await prisma.reminderDispatch.updateMany({
          where: { reminderId: r.id, cycleDueAt: r.dueAt, kind, offsetMin },
          data: { ok: false },
        });
      }
    }

    // ----------------------------------------------------------------- email
    if (!owner.emailOptIn || !owner.email) {
      summary.emailsSkippedOptOut++;
    } else {
      const gapMins = Math.max(
        owner.overdueRepeatMins,
        EMAIL_OVERDUE_MIN_GAP_MINS,
      );
      const previous = lastEmailAt.get(r.id);
      const throttled =
        kind === "overdue" &&
        previous !== undefined &&
        now.getTime() - previous < gapMins * MS_PER_MIN;

      if (throttled) {
        summary.emailsThrottled++;
      } else {
        const { subject, html } = buildReminderEmail({
          userName: owner.name,
          title: r.title,
          description: r.description,
          category: r.category?.name ?? null,
          amount: r.amount,
          dueAt: r.dueAt,
          timeZone: owner.timezone,
          kind,
          minutesUntilDue: fire.minutesUntilDue,
        });
        if (await sendMail({ to: owner.email, subject, html })) {
          summary.emailsSent++;
          reminderUpdate.lastEmailedAt = now;
          lastEmailAt.set(r.id, now.getTime());
        }
      }
    }

    if (Object.keys(reminderUpdate).length > 0) {
      await prisma.reminder.update({
        where: { id: r.id },
        data: reminderUpdate,
      });
    }
  }

  return summary;
}

/** Fires a one-off push so a user can confirm delivery works end to end. */
export async function sendTestPush(userId: string) {
  const appName = process.env.APP_NAME || "PRO-SYS";
  const badge = await countOutstanding(userId);
  return sendPushToUser(userId, {
    title: `${appName} test notification`,
    body: "If you can see this on your lock screen, push is working.",
    tag: "prosys-test",
    kind: "test",
    badge,
    url: "/settings",
  });
}

/** How many of this user's devices are currently reachable. */
export function countUserSubscriptions(userId: string) {
  return countSubscriptions(userId);
}

/** Sends a one-off email so a user can confirm SMTP reaches them. */
export async function sendTestEmail(
  to: string,
  userName: string,
): Promise<boolean> {
  const appName = process.env.APP_NAME || "PRO-SYS";
  return sendMail({
    to,
    subject: `${appName}: test email`,
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;">
        <h2 style="margin:0 0 8px;">${appName}</h2>
        <p>Hi ${userName}, email reminders are working — this is a test.</p>
        <p style="color:#6b7280;font-size:13px;">
          Real reminders arrive when something is due, plus any advance alerts you
          tick on the reminder itself.
        </p>
      </div>`,
  });
}
