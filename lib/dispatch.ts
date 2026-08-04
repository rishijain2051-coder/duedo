import { prisma } from "./db";
import { sendPushToUser, isPushConfigured } from "./push";
import { sendMail, isMailConfigured } from "./mail";
import { buildReminderEmail, type AlertKind } from "./reminder-email";
import { recipientsFor, countOutstandingFor } from "./recipients";
import { familyIdsFor } from "./families";
import { formatInZone, formatTimeInZone, humanizeMinutes } from "./time";

// The reminder engine. Called once a minute by Supabase pg_cron (see DEPLOY.md),
// which is why every decision below has to be idempotent: a duplicated or delayed
// cron tick must not produce a duplicate notification.
//
// A reminder can now reach several people — a family reminder addressed to
// everyone — so the unit of work is (fire × recipient), not just fire. Dedupe,
// channel choice and email throttling are all per recipient; the nag *schedule*
// stays per reminder, because whether something is overdue is a fact about the
// reminder rather than about who is being told.

const MS_PER_MIN = 60_000;

/**
 * Floor on how often one person may be emailed about the same *overdue*
 * reminder, regardless of how short the nag interval is.
 *
 * Push nags are collapsible — a new one replaces the last on the lock screen — so
 * hourly is fine there. An inbox has no such thing, and hourly mail about the
 * same unpaid bill is how people learn to ignore an app. Lead and due-time emails
 * are never throttled; only the repeats are.
 */
const EMAIL_OVERDUE_MIN_GAP_MINS = 12 * 60;

/** How many DispatchRun rows to keep. Enough to see a pattern, not unbounded. */
const RUN_HISTORY = 500;

/**
 * How long an overdue reminder keeps nagging. The reminder stays overdue and visible
 * in the list forever — this only stops the notifications.
 */
const OVERDUE_NAG_LIMIT_DAYS = 14;

/**
 * How long the dedupe ledger and the notification feed are kept.
 *
 * Both were unbounded. ReminderDispatch exists to stop an alert going twice, which
 * only matters while a due-cycle is current; Notification is a feed the UI reads 100
 * rows of. Keeping 90 days of each leaves plenty of history to look back through
 * while making total storage a function of *active* use rather than of how long the
 * install has existed.
 */
const RETENTION_DAYS = 90;

interface Owner {
  id: string;
  overdueRepeatMins: number;
}

interface ReminderRow {
  id: string;
  userId: string;
  familyId: string | null;
  assignedToId: string | null;
  audience: string;
  title: string;
  description: string | null;
  dueAt: Date;
  leadOffsets: number[];
  amount: number | null;
  createdAt: Date;
  lastNaggedAt: Date | null;
  snoozedUntil: Date | null;
  user: Owner;
  family: { name: string } | null;
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

/** The per-recipient facts needed to decide and address a delivery. */
interface Recipient {
  id: string;
  name: string;
  email: string;
  timezone: string;
  emailOptIn: boolean;
  pushOptIn: boolean;
}

export interface DispatchSummary {
  ran: boolean;
  pushConfigured: boolean;
  mailConfigured: boolean;
  subscriptions: number;
  considered: number;
  /** Distinct (fire × recipient) pairs actually delivered on this run. */
  recipients: number;
  fired: Record<AlertKind, number>;
  skippedAlreadySent: number;
  notificationsCreated: number;
  pushesSent: number;
  pushesFailed: number;
  pushesSkippedOptOut: number;
  emailsSent: number;
  emailsThrottled: number;
  emailsSkippedOptOut: number;
  durationMs: number;
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
  //
  // Nagging stops after OVERDUE_NAG_LIMIT_DAYS. Two reasons, and the second is the
  // one that forced it: something a fortnight overdue is not a reminder any more —
  // hourly notifications about it have stopped being information and become noise
  // people learn to swipe away. And because `offsetMin` is minutes-since-due, every
  // nag is a distinct ReminderDispatch plus Notification row, so an abandoned
  // reminder wrote ~24 row-pairs a day forever: measured at 571 bytes a pair, that is
  // 5 MB per year *each*, more than a whole active household generates. It was the
  // only unbounded growth path in the schema.
  const daysOverdue = (nowMs - dueMs) / (24 * 60 * MS_PER_MIN);
  if (daysOverdue <= OVERDUE_NAG_LIMIT_DAYS) {
    const baseline = (r.lastNaggedAt ?? r.dueAt).getTime();
    if (nowMs - baseline >= overdueRepeatMins * MS_PER_MIN) {
      const slot = Math.floor((nowMs - dueMs) / MS_PER_MIN);
      if (slot > 0) {
        fires.push({ reminder: r, kind: "overdue", offsetMin: slot, minutesUntilDue });
      }
    }
  }

  return fires;
}

/**
 * Alert copy, rendered in the *recipient's* timezone rather than the creator's —
 * on a shared family reminder those can differ, and a time the reader can't act
 * on is worse than no time.
 */
function buildCopy(fire: Fire, timeZone: string): { title: string; body: string } {
  const { reminder: r, kind, minutesUntilDue } = fire;
  const amount =
    r.amount && r.amount > 0 ? ` · ₹${r.amount.toLocaleString("en-IN")}` : "";
  // Family reminders say which household, since a member may be in several.
  const scope = r.family?.name ? ` [${r.family.name}]` : "";
  const category = r.category?.name ? ` (${r.category.name})` : "";

  if (kind === "lead") {
    return {
      title: `${r.title}${scope}`,
      body: `Due in ${humanizeMinutes(minutesUntilDue)} — ${formatInZone(r.dueAt, timeZone)}${amount}`,
    };
  }
  if (kind === "due") {
    return {
      title: `Due now: ${r.title}${scope}`,
      body: `${formatTimeInZone(r.dueAt, timeZone)}${category}${amount}`,
    };
  }
  return {
    title: `Still due: ${r.title}${scope}`,
    body: `Overdue by ${humanizeMinutes(-minutesUntilDue)} — was due ${formatInZone(r.dueAt, timeZone)}${amount}`,
  };
}

export async function dispatchDueReminders(
  now: Date = new Date(),
): Promise<DispatchSummary> {
  const startedAt = Date.now();

  // One query for every candidate across every account.
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
      familyId: true,
      assignedToId: true,
      audience: true,
      title: true,
      description: true,
      dueAt: true,
      leadOffsets: true,
      amount: true,
      createdAt: true,
      lastNaggedAt: true,
      snoozedUntil: true,
      user: { select: { id: true, overdueRepeatMins: true } },
      family: { select: { name: true } },
      category: { select: { name: true } },
    },
  })) as ReminderRow[];

  const summary: DispatchSummary = {
    ran: true,
    pushConfigured: isPushConfigured(),
    mailConfigured: isMailConfigured(),
    subscriptions: await prisma.pushSubscription.count({
      where: { blockedAt: null, user: { status: "active" } },
    }),
    considered: reminders.length,
    recipients: 0,
    fired: { lead: 0, due: 0, overdue: 0 },
    skippedAlreadySent: 0,
    notificationsCreated: 0,
    pushesSent: 0,
    pushesFailed: 0,
    pushesSkippedOptOut: 0,
    emailsSent: 0,
    emailsThrottled: 0,
    emailsSkippedOptOut: 0,
    durationMs: 0,
  };

  const plan = reminders.flatMap((r) =>
    planFires(r, now, r.user.overdueRepeatMins),
  );

  // Per-run caches. Volumes here are small (a household, not a mailing list), so
  // these exist to avoid silly repetition rather than to scale.
  const recipientIdCache = new Map<string, string[]>();
  const userCache = new Map<string, Recipient>();
  const familyIdCache = new Map<string, string[]>();
  /** Newest email instant per `${reminderId}:${userId}`, for the throttle. */
  const lastEmailAt = new Map<string, number>();

  async function resolveRecipients(r: ReminderRow): Promise<string[]> {
    const hit = recipientIdCache.get(r.id);
    if (hit) return hit;
    const ids = await recipientsFor(r);
    recipientIdCache.set(r.id, ids);
    return ids;
  }

  async function loadUsers(ids: string[]): Promise<void> {
    const missing = ids.filter((id) => !userCache.has(id));
    if (missing.length === 0) return;
    const rows = await prisma.user.findMany({
      where: { id: { in: missing }, status: "active" },
      select: {
        id: true,
        name: true,
        email: true,
        timezone: true,
        emailOptIn: true,
        pushOptIn: true,
      },
    });
    for (const u of rows) userCache.set(u.id, u);
  }

  async function familyIds(userId: string): Promise<string[]> {
    const hit = familyIdCache.get(userId);
    if (hit) return hit;
    const ids = await familyIdsFor(userId);
    familyIdCache.set(userId, ids);
    return ids;
  }

  async function lastEmailedAt(
    reminderId: string,
    userId: string,
  ): Promise<number | undefined> {
    const key = `${reminderId}:${userId}`;
    if (lastEmailAt.has(key)) return lastEmailAt.get(key);
    const row = await prisma.reminderDispatch.findFirst({
      where: { reminderId, userId, emailedAt: { not: null } },
      orderBy: { emailedAt: "desc" },
      select: { emailedAt: true },
    });
    if (row?.emailedAt) {
      lastEmailAt.set(key, row.emailedAt.getTime());
      return row.emailedAt.getTime();
    }
    return undefined;
  }

  for (const fire of plan) {
    const { reminder: r, kind, offsetMin } = fire;

    const ids = await resolveRecipients(r);
    await loadUsers(ids);

    let deliveredToAnyone = false;

    for (const recipientId of ids) {
      const person = userCache.get(recipientId);
      if (!person) continue; // not active any more

      // Claim the slot BEFORE sending. The unique index on
      // (reminderId, userId, cycleDueAt, kind, offsetMin) is what makes a repeated
      // or overlapping cron tick a no-op instead of a second notification — and
      // including userId is what stops one family member's row suppressing the rest.
      try {
        await prisma.reminderDispatch.create({
          data: {
            reminderId: r.id,
            userId: recipientId,
            cycleDueAt: r.dueAt,
            kind,
            offsetMin,
          },
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          summary.skippedAlreadySent++;
          continue;
        }
        throw err;
      }

      deliveredToAnyone = true;
      summary.recipients++;

      const { title, body } = buildCopy(fire, person.timezone);

      // The in-app feed records every alert regardless of channel, so nothing is
      // lost when a push fails or email is off.
      await prisma.notification.create({
        data: { userId: recipientId, reminderId: r.id, title, body, kind },
      });
      summary.notificationsCreated++;

      // ---------------------------------------------------------------- push
      if (!person.pushOptIn) {
        summary.pushesSkippedOptOut++;
      } else {
        const badge = await countOutstandingFor(
          recipientId,
          await familyIds(recipientId),
          now,
        );
        const result = await sendPushToUser(recipientId, {
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
            where: {
              reminderId: r.id,
              userId: recipientId,
              cycleDueAt: r.dueAt,
              kind,
              offsetMin,
            },
            data: { ok: false },
          });
        }
      }

      // --------------------------------------------------------------- email
      if (!person.emailOptIn || !person.email) {
        summary.emailsSkippedOptOut++;
        continue;
      }

      const gapMins = Math.max(
        r.user.overdueRepeatMins,
        EMAIL_OVERDUE_MIN_GAP_MINS,
      );
      const previous = await lastEmailedAt(r.id, recipientId);
      const throttled =
        kind === "overdue" &&
        previous !== undefined &&
        now.getTime() - previous < gapMins * MS_PER_MIN;

      if (throttled) {
        summary.emailsThrottled++;
        continue;
      }

      const { subject, html } = buildReminderEmail({
        userName: person.name,
        title: r.family?.name ? `${r.title} [${r.family.name}]` : r.title,
        description: r.description,
        category: r.category?.name ?? null,
        amount: r.amount,
        dueAt: r.dueAt,
        timeZone: person.timezone,
        kind,
        minutesUntilDue: fire.minutesUntilDue,
      });
      if (await sendMail({ to: person.email, subject, html })) {
        summary.emailsSent++;
        const at = new Date();
        await prisma.reminderDispatch.updateMany({
          where: {
            reminderId: r.id,
            userId: recipientId,
            cycleDueAt: r.dueAt,
            kind,
            offsetMin,
          },
          data: { emailedAt: at },
        });
        lastEmailAt.set(`${r.id}:${recipientId}`, at.getTime());
      }
    }

    if (deliveredToAnyone) summary.fired[kind]++;

    // Once per fire, not per recipient: the nag schedule belongs to the reminder.
    if (deliveredToAnyone && kind !== "lead") {
      await prisma.reminder.update({
        where: { id: r.id },
        data: { lastNaggedAt: now },
      });
    }
  }

  summary.durationMs = Date.now() - startedAt;
  await recordRun(summary);
  await pruneRetention(now);
  return summary;
}

/** Persists the tick so the admin health page can answer "is delivery working?". */
async function recordRun(s: DispatchSummary, error?: string): Promise<void> {
  try {
    await prisma.dispatchRun.create({
      data: {
        durationMs: s.durationMs,
        considered: s.considered,
        recipients: s.recipients,
        firedLead: s.fired.lead,
        firedDue: s.fired.due,
        firedOverdue: s.fired.overdue,
        pushesSent: s.pushesSent,
        pushesFailed: s.pushesFailed,
        emailsSent: s.emailsSent,
        error: error ?? null,
      },
    });

    // Prune here rather than on a schedule — this is the only writer, so it is
    // the only place that knows the table grew.
    const total = await prisma.dispatchRun.count();
    if (total > RUN_HISTORY * 1.2) {
      const cutoff = await prisma.dispatchRun.findMany({
        orderBy: { ranAt: "desc" },
        skip: RUN_HISTORY,
        take: 1,
        select: { ranAt: true },
      });
      if (cutoff[0]) {
        await prisma.dispatchRun.deleteMany({
          where: { ranAt: { lt: cutoff[0].ranAt } },
        });
      }
    }
  } catch (err) {
    console.error("[dispatch] could not record run:", (err as Error).message);
  }
}

/**
 * Drops dedupe rows and feed entries past the retention window.
 *
 * Sampled rather than run every minute: at one in sixty ticks this is roughly hourly,
 * which is far more often than a 90-day window needs, and it keeps the ordinary tick
 * down to the work it exists to do. Both deletes are indexed range scans.
 *
 * Safe for a reminder that is *still* overdue at the cutoff: `offsetMin` on an
 * overdue row is minutes-since-due, so it only ever increases — a pruned slot can
 * never come round again and be re-sent. Lead and due rows are keyed on the cycle's
 * dueAt, and a cycle 90 days behind has either rolled over or stopped nagging.
 */
async function pruneRetention(now: Date): Promise<void> {
  if (Math.floor(now.getTime() / 60_000) % 60 !== 0) return;
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * MS_PER_MIN);
  try {
    const [dispatches, notifications] = await Promise.all([
      prisma.reminderDispatch.deleteMany({ where: { cycleDueAt: { lt: cutoff } } }),
      prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    ]);
    if (dispatches.count || notifications.count) {
      console.log(
        `[dispatch] pruned ${dispatches.count} dedupe rows and ${notifications.count} notifications older than ${RETENTION_DAYS} days`,
      );
    }
  } catch (err) {
    // Housekeeping must never stop delivery.
    console.error("[dispatch] retention prune failed:", (err as Error).message);
  }
}

/** Records a run that threw, so a broken dispatcher is visible rather than silent. */
export async function recordFailedRun(
  error: string,
  durationMs: number,
): Promise<void> {
  await recordRun(
    {
      ran: false,
      pushConfigured: false,
      mailConfigured: false,
      subscriptions: 0,
      considered: 0,
      recipients: 0,
      fired: { lead: 0, due: 0, overdue: 0 },
      skippedAlreadySent: 0,
      notificationsCreated: 0,
      pushesSent: 0,
      pushesFailed: 0,
      pushesSkippedOptOut: 0,
      emailsSent: 0,
      emailsThrottled: 0,
      emailsSkippedOptOut: 0,
      durationMs,
    },
    error.slice(0, 500),
  );
}

/** Fires a one-off push so a user can confirm delivery works end to end. */
export async function sendTestPush(userId: string) {
  const appName = process.env.APP_NAME || "PRO-SYS";
  const badge = await countOutstandingFor(userId, await familyIdsFor(userId));
  return sendPushToUser(userId, {
    title: `${appName} test notification`,
    body: "If you can see this on your lock screen, push is working.",
    tag: "prosys-test",
    kind: "test",
    badge,
    url: "/settings",
  });
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
