import { prisma } from "./db";
import { escapeHtml } from "./html";
import { sendPushToUser, isPushConfigured } from "./push";
import { sendMail, isMailConfigured } from "./mail";
import { buildReminderEmail, type AlertKind } from "./reminder-email";
import { readEscalation, type EscalationTarget } from "./escalation";
import { contactSendable } from "./external-contacts";
import { recipientsFor, countOutstandingFor } from "./recipients";
import { familyIdsFor } from "./families";
import { formatInZone, formatTimeInZone, humanizeMinutes } from "./time";
// lib/plan.ts and not lib/plan-guard.ts on purpose: this file reads an entitlement,
// it never refuses a write, and importing the guard would put a throw within reach of
// the one code path that must never have one.
import { limitsFor } from "./plan";

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
/**
 * How many *successful* dispatch runs to keep. Failures are all kept — see the prune
 * in recordRun for why the two are treated differently.
 */
const SUCCESSFUL_RUN_HISTORY = 10;

/**
 * How long an overdue reminder keeps nagging. The reminder stays overdue and visible
 * in the list forever — this only stops the notifications.
 */
const OVERDUE_NAG_LIMIT_DAYS = 14;

/**
 * How long an unread notification is kept. Read ones go much sooner — see below.
 */
const NOTIFICATION_UNREAD_DAYS = 90;

/**
 * How long a *read* notification is kept.
 *
 * The feed exists so a failed push or email still leaves a trace. Once somebody has
 * read the entry it has done that job, and 90 days of read alerts is the largest
 * app-side table for no benefit anyone can name. Unread ones keep the full window,
 * because an unread alert is the one that might still be news.
 */
const NOTIFICATION_READ_DAYS = 14;

/**
 * How long a MonthlyRollup is kept. The year view reads twelve months, so twice that
 * loses nothing and stops the only app table with no ceiling at all from having none.
 */
const ROLLUP_MONTHS = 24;

/**
 * Overdue dedupe rows exist to stop two ticks in the same minute sending the same nag.
 * `offsetMin` is minutes-since-due and only ever increases, so once the minute has
 * passed the slot can never come round again and the row has no further job.
 *
 * Two minutes rather than one, so a tick that straddles a minute boundary still finds
 * the row it wrote.
 */
const OVERDUE_LEDGER_MINS = 2;

/**
 * Escalation rows, and overdue rows that carried an email, are kept until a day past
 * the nag limit — no step is ever planned beyond OVERDUE_NAG_LIMIT_DAYS, and the
 * emailed ones are what the 12-hour cap reads.
 */
const LEDGER_TAIL_DAYS = OVERDUE_NAG_LIMIT_DAYS + 1;

/**
 * Failed runs kept from each end of the table.
 *
 * Failures used to be unbounded on the reasoning that the *oldest* failure is the most
 * useful, being when the problem started — which is right, and is why a plain "keep the
 * newest N" would be wrong. But nothing bounded them at all: a dispatcher broken for a
 * month reaches ~43,000 rows and 27 MB, and a 30-day window would not have helped,
 * because that is the window. Keeping both ends preserves the onset *and* the current
 * state, and caps the table at twice this number however long the outage lasts.
 */
const FAILED_RUNS_EACH_END = 20;

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
  acknowledgedAt: Date | null;
  /** Raw Json; read through readEscalation, which tolerates anything unexpected. */
  escalation: unknown;
  user: Owner;
  family: { name: string } | null;
  category: { name: string } | null;
  /** Only used by the escalation copy, which has to say whose job this was. */
  assignedTo: { name: string } | null;
}

interface Fire {
  reminder: ReminderRow;
  kind: AlertKind;
  /**
   * lead: the offset in minutes. due: 0. overdue: whole minutes since dueAt.
   * escalation: the step's own `afterMins`, which is what makes each step fire once per
   * cycle through the existing dedupe key with no new machinery.
   */
  offsetMin: number;
  /** Minutes until due — negative once overdue. */
  minutesUntilDue: number;
  /** Set only on an escalation fire: who this step is climbing to. */
  escalateTo?: EscalationTarget;
  /** Set only when escalateTo is "external". */
  contactId?: string;
}

/** The per-recipient facts needed to decide and address a delivery. */
interface Recipient {
  id: string;
  name: string;
  email: string;
  timezone: string;
  emailOptIn: boolean;
  pushOptIn: boolean;
  /**
   * Billing, and the *only* thing in this file that reads it.
   *
   * It decides one question — whether this person is emailed — and nothing else. Which
   * reminders fire, when, and to whom is settled entirely without it, so a lapsed
   * account keeps every alert it had; push is unlimited on every plan and costs nothing
   * to send. A plan must never be able to silence a reminder outright.
   */
  plan: string;
  premiumUntil: Date | null;
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
  /** Recipients whose plan doesn't include email. They still got push and the feed. */
  emailsSkippedPlan: number;
  /** Escalations to an outside address that the consent rule stopped. Not a failure. */
  escalationsWithheld: number;
  durationMs: number;
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

  // ------------------------------------------------------------------ escalation
  // Every step whose time has come, once per cycle each. `offsetMin` is the step's own
  // `afterMins`, so the existing unique key on
  // (reminderId, userId, cycleDueAt, kind, offsetMin) does the once-only work with nothing
  // added — which is a good sign the key was right to begin with.
  //
  // Three guards, and none of them is obvious:
  //
  //   * acknowledgement stops the chain dead. Somebody saying "I'll handle it" is the
  //     exact signal escalation exists to wait for, and climbing past it would punish the
  //     one person who answered;
  //   * the same OVERDUE_NAG_LIMIT_DAYS cap applies, so a chain can't outlive the nagging
  //     it escalates — otherwise the app goes quiet to the assignee while still mailing
  //     the landlord every day;
  //   * a reminder with no chain never enters this block at all, so it takes byte-identical
  //     paths to before escalation existed.
  if (!r.acknowledgedAt && daysOverdue <= OVERDUE_NAG_LIMIT_DAYS) {
    const minutesOverdue = Math.floor((nowMs - dueMs) / MS_PER_MIN);
    for (const step of readEscalation(r.escalation)) {
      if (minutesOverdue < step.afterMins) continue;
      fires.push({
        reminder: r,
        kind: "escalation",
        offsetMin: step.afterMins,
        minutesUntilDue,
        escalateTo: step.notify,
        contactId: step.contactId,
      });
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
  // Escalation goes to somebody who is not the person who was supposed to do it — the
  // family head, an admin, or a contact outside the app entirely. Worded like the
  // overdue nag below, which is what it used to be, it read as their own reminder: no
  // hint that it had escalated, and none of whose job it was. A landlord got a message
  // indistinguishable from one of their own.
  if (kind === "escalation") {
    const whose = r.assignedTo?.name
      ? `Assigned to ${r.assignedTo.name}`
      : "Nobody has taken it on";
    return {
      title: `Still not done: ${r.title}${scope}`,
      body: `${whose} — overdue by ${humanizeMinutes(-minutesUntilDue)}, was due ${formatInZone(r.dueAt, timeZone)}${amount}`,
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
      acknowledgedAt: true,
      escalation: true,
      user: { select: { id: true, overdueRepeatMins: true } },
      family: { select: { name: true } },
      category: { select: { name: true } },
      // For the escalation wording only. One more join on a query that already makes
      // three, and escalation is unreadable without it — "still not done" tells the
      // family head nothing if it doesn't say whose job it was.
      assignedTo: { select: { name: true } },
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
    fired: { lead: 0, due: 0, overdue: 0, escalation: 0 },
    skippedAlreadySent: 0,
    notificationsCreated: 0,
    pushesSent: 0,
    pushesFailed: 0,
    pushesSkippedOptOut: 0,
    emailsSent: 0,
    emailsThrottled: 0,
    emailsSkippedOptOut: 0,
    emailsSkippedPlan: 0,
    escalationsWithheld: 0,
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
        plan: true,
        premiumUntil: true,
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
      // Overdue rows only. The 12-hour cap below applies to overdue repeats and
      // nothing else — "the first alert is never throttled; only the repeats are" —
      // but this read took the newest emailedAt of *any* kind, so a lead email an hour
      // earlier suppressed the due-time overdue email that was supposed to follow it.
      // Filtering here is what makes that comment true, and it is also what lets the
      // sweep delete lead and due rows without loosening the cap.
      where: { reminderId, userId, kind: "overdue", emailedAt: { not: null } },
      orderBy: { emailedAt: "desc" },
      select: { emailedAt: true },
    });
    if (row?.emailedAt) {
      lastEmailAt.set(key, row.emailedAt.getTime());
      return row.emailedAt.getTime();
    }
    return undefined;
  }

  /**
   * Who an escalation step climbs to.
   *
   * Falls back to the creator whenever the intended target has gone, on the same reasoning
   * as recipientsFor(): silence is the worse failure. An `external` step returns no in-app
   * recipients at all — it is handled before this loop, because there is no User row to
   * address.
   */
  async function escalationRecipients(
    r: ReminderRow,
    to: EscalationTarget,
  ): Promise<string[]> {
    if (to === "assignee") return [r.assignedToId ?? r.userId];
    if (to === "head") {
      if (!r.familyId) return [r.userId];
      const head = await prisma.familyMember.findFirst({
        where: { familyId: r.familyId, role: "head", user: { status: "active" } },
        select: { userId: true },
      });
      return [head?.userId ?? r.userId];
    }
    if (to === "admins") {
      const admins = await prisma.user.findMany({
        where: { role: "admin", status: "active" },
        select: { id: true },
      });
      return admins.length > 0 ? admins.map((a) => a.id) : [r.userId];
    }
    return [];
  }

  for (const fire of plan) {
    const { reminder: r, kind, offsetMin } = fire;

    // ------------------------------------------------ escalation to someone outside
    // Handled apart from the per-recipient loop because there is no account to loop
    // over: an ExternalContact is an address, not a user. The dedupe row is still
    // written, against the *creator's* id — the (reminder, cycle, kind, offsetMin) part
    // is what makes it once-per-cycle, and steps are de-duplicated by minute when the
    // chain is saved, so no two can collide on the same creator.
    if (fire.escalateTo === "external") {
      if (!fire.contactId) continue;
      const claimed = await prisma.reminderDispatch.createMany({
        data: [
          {
            reminderId: r.id,
            userId: r.userId,
            cycleDueAt: r.dueAt,
            kind,
            offsetMin,
          },
        ],
        skipDuplicates: true,
      });
      if (claimed.count === 0) {
        summary.skippedAlreadySent++;
        continue;
      }

      const creator = userCache.get(r.userId) ?? (await loadUsers([r.userId]), userCache.get(r.userId));
      const state = await contactSendable(fire.contactId, {
        reminderTitle: r.title,
        requesterName: creator?.name ?? "Someone",
      });
      if (state !== "confirmed") {
        // Not an error. An unconfirmed or blocked contact is the consent rule working;
        // the slot stays claimed so the next tick doesn't re-invite them.
        summary.escalationsWithheld++;
        continue;
      }

      const contact = await prisma.externalContact.findUnique({
        where: { id: fire.contactId },
        select: { email: true },
      });
      if (!contact) continue;

      const mail = buildReminderEmail({
        userName: contact.email,
        title: r.title,
        description: r.description,
        category: r.category?.name ?? null,
        amount: r.amount,
        dueAt: r.dueAt,
        timeZone: creator?.timezone ?? "Asia/Kolkata",
        kind,
        minutesUntilDue: fire.minutesUntilDue,
      });
      if (await sendMail({ to: contact.email, subject: mail.subject, html: mail.html })) {
        summary.emailsSent++;
        summary.fired.escalation++;
      }
      continue;
    }

    const ids = fire.escalateTo
      ? await escalationRecipients(r, fire.escalateTo)
      : await resolveRecipients(r);
    await loadUsers(ids);

    let deliveredToAnyone = false;

    for (const recipientId of ids) {
      const person = userCache.get(recipientId);
      if (!person) continue; // not active any more

      // Claim the slot BEFORE sending. The unique index on
      // (reminderId, userId, cycleDueAt, kind, offsetMin) is what makes a repeated
      // or overlapping cron tick a no-op instead of a second notification — and
      // including userId is what stops one family member's row suppressing the rest.
      //
      // `createMany` + skipDuplicates, not `create` in a try/catch: it compiles to
      // INSERT ... ON CONFLICT DO NOTHING, so an already-claimed slot returns a count
      // of 0 instead of raising. The claim is just as atomic, and the difference shows
      // up in the database log.
      //
      // It matters because a duplicate here is *normal steady state*, not an
      // exception. Every tick re-plans the `due` alert for anything overdue, so each
      // overdue reminder produced one failed INSERT a minute per recipient — around
      // 1,400 Postgres ERROR lines a day, each one an aborted transaction, and each
      // one indistinguishable at a glance from a real fault in the logs.
      const claimed = await prisma.reminderDispatch.createMany({
        data: [
          {
            reminderId: r.id,
            userId: recipientId,
            cycleDueAt: r.dueAt,
            kind,
            offsetMin,
          },
        ],
        skipDuplicates: true,
      });
      if (claimed.count === 0) {
        summary.skippedAlreadySent++;
        continue;
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
          family: Boolean(r.familyId),
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

      // The one billing check in the dispatcher, and it is deliberately the last thing
      // before an email rather than anything earlier: by this point the notification is
      // already recorded and the push already sent, so a free account is reminded, on
      // time, through every channel that costs nothing to run. Email is the one with a
      // real ceiling — a single SMTP account, a few hundred a day, shared by everyone —
      // which is why it is the channel that is sold.
      //
      // Counted separately from an opt-out so the health page never reports someone who
      // has not paid as someone who has switched email off.
      if (!limitsFor(person).email) {
        summary.emailsSkippedPlan++;
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
  // The sweeps are deliberately NOT called here. They are housekeeping, and housekeeping
  // is driven from the cron route so that `?now=` skips it — the same rule the audit
  // rotation and the month close already follow. Time travel exists to test what the
  // engine *sends*; pointed at a delete it becomes a way to destroy rows that are still
  // live, and these sweeps compare a travelled `now` against a real `firedAt`, so the
  // dispatch suite ticking a year ahead would have emptied the ledger under itself.
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
        firedEscalation: s.fired.escalation,
        pushesSent: s.pushesSent,
        pushesFailed: s.pushesFailed,
        emailsSent: s.emailsSent,
        error: error ?? null,
      },
    });

    // Prune here rather than on a schedule — this is the only writer, so it is
    // the only place that knows the table grew.
    //
    // Successful runs and failed ones are not worth the same. A successful tick is
    // interchangeable with every other successful tick: the newest few prove the
    // dispatcher is alive, and the 1,440th copy of "ran, sent nothing" says no more
    // than the first. A failure is evidence — and the *oldest* failure is usually the
    // most useful one, because it is when the problem started. So successes are
    // capped and failures are kept.
    //
    // Failures are now bounded too, but from both ends rather than by age. Nothing
    // bounded them at all before: a dispatcher broken for a month reaches ~43,000 rows
    // and, at the measured 627 bytes each, 27 MB — while the admin page showed it red
    // the whole time. A 30-day window would not have helped, since a month is the
    // window. Keeping the oldest few and the newest few holds on to the onset, which is
    // the reading this table is actually opened for, plus where things stand now.
    const stale = await prisma.dispatchRun.findMany({
      where: { error: null },
      orderBy: { ranAt: "desc" },
      skip: SUCCESSFUL_RUN_HISTORY,
      select: { id: true },
    });

    const middle: { id: string }[] = [];
    const failures = await prisma.dispatchRun.count({ where: { error: { not: null } } });
    if (failures > FAILED_RUNS_EACH_END * 2) {
      middle.push(
        ...(await prisma.dispatchRun.findMany({
          where: { error: { not: null } },
          orderBy: { ranAt: "desc" },
          skip: FAILED_RUNS_EACH_END,
          take: failures - FAILED_RUNS_EACH_END * 2,
          select: { id: true },
        })),
      );
    }

    const ids = [...stale, ...middle].map((r) => r.id);
    if (ids.length > 0) {
      await prisma.dispatchRun.deleteMany({ where: { id: { in: ids } } });
    }
  } catch (err) {
    console.error("[dispatch] could not record run:", (err as Error).message);
  }
}

/**
 * Drops every dedupe row for one reminder, because none of them can be reached again.
 *
 * Called when a reminder completes, and when its `dueAt` or `status` changes. In each
 * case planFires can no longer plan any cycle those rows key:
 *
 *   * completing a one-off ends at `status: "completed"`, which the dispatcher's query
 *     excludes, and there is no un-complete route anywhere in the app;
 *   * completing a recurring one rolls `dueAt` strictly forward, so the settled
 *     `cycleDueAt` is behind the only cycle that can now be planned;
 *   * re-dating or archiving likewise leaves every stored `cycleDueAt` unreachable —
 *     and PATCH already treats a moved due instant as a fresh notification cycle for
 *     exactly this reason.
 *
 * This is what makes a window over ReminderDispatch unnecessary rather than merely
 * generous: rows are removed at the moment they become unreachable instead of three
 * months later on the hope that they have. It is a plain delete keyed on an indexed
 * column, and idempotent — a completion replayed from an offline queue simply finds
 * nothing left to remove.
 */
export async function clearDispatchLedger(reminderId: string): Promise<number> {
  try {
    const { count } = await prisma.reminderDispatch.deleteMany({
      where: { reminderId },
    });
    return count;
  } catch (err) {
    // Never at the cost of the write that triggered it. A row left behind only means a
    // later sweep or the next completion clears it.
    console.error("[dispatch] could not clear the ledger:", (err as Error).message);
    return 0;
  }
}

/**
 * Reduces the dedupe ledger to the cycles that are still open.
 *
 * This replaces a 90-day window over ReminderDispatch, which was wrong in a way that
 * was invisible until you looked for it. The window's stated safety was that "a cycle
 * 90 days behind has either rolled over or stopped nagging" — true of leads and of
 * nagging, but the **due** fire at planFires has no time cap at all. So for any active
 * reminder more than 90 days overdue — an abandoned one, or one somebody backdated —
 * the hourly prune deleted its due row, the next tick re-planned the due alert and sent
 * it again, and wrote a fresh row for the prune to delete an hour later. It nagged
 * hourly, forever, having promised to stop after a fortnight.
 *
 * The fix is not a bigger window. Each kind is unreachable at a different, provable
 * moment, and a due row is unreachable only once its reminder moves on:
 *
 *   * **lead** — planned solely in the `!isDue` branch, so once `cycleDueAt` has passed
 *     that cycle's leads can never be planned again;
 *   * **overdue** — `offsetMin` is minutes-since-due and only increases, so a slot
 *     cannot recur. The row guards two ticks inside one minute and nothing else. The
 *     exception is a row that carried an email: that is what the 12-hour cap reads, so
 *     it stays until the nag limit;
 *   * **escalation** — no step is planned past OVERDUE_NAG_LIMIT_DAYS;
 *   * **due** — deliberately not swept. It is the only row standing between an active
 *     overdue reminder and a repeat of its due alert, and there is no age at which that
 *     stops being true. Capping the due fire at 14 days instead would make a window
 *     safe, but it would also silence a legitimately backdated reminder, and unlike
 *     leads the due alert has no no-back-fill rule to lean on. So it is held until the
 *     reminder is completed, re-dated or deleted — see clearDispatchLedger.
 *
 * What is retained is therefore "cycles still open" rather than "the last three
 * months": one due row per open cycle per recipient, bounded by how many reminders
 * people abandon rather than by how long the install has existed.
 *
 * Runs every tick, not sampled. The whole point is that the ledger stays small, and
 * these are narrow deletes against a table this keeps small in the first place.
 */
export async function sweepDispatchLedger(now = new Date()): Promise<number> {
  const overdueCutoff = new Date(now.getTime() - OVERDUE_LEDGER_MINS * MS_PER_MIN);
  const tailCutoff = new Date(now.getTime() - LEDGER_TAIL_DAYS * 24 * 60 * MS_PER_MIN);
  try {
    const removed = await prisma.reminderDispatch.deleteMany({
      where: {
        OR: [
          { kind: "lead", cycleDueAt: { lte: now } },
          // The bulk of the ledger. Only the ones that never carried an email, so the
          // cap below keeps the evidence it depends on.
          { kind: "overdue", emailedAt: null, firedAt: { lt: overdueCutoff } },
          { kind: "overdue", emailedAt: { not: null }, cycleDueAt: { lt: tailCutoff } },
          { kind: "escalation", cycleDueAt: { lt: tailCutoff } },
        ],
      },
    });
    if (removed.count > 0) {
      console.log(`[dispatch] swept ${removed.count} spent dedupe rows`);
    }
    return removed.count;
  } catch (err) {
    // Housekeeping must never stop delivery.
    console.error("[dispatch] ledger sweep failed:", (err as Error).message);
    return 0;
  }
}

/**
 * Bounds the feed, expired logins and the rollup table.
 *
 * Sampled at one tick in sixty, so roughly hourly: none of these needs to be prompt,
 * and the ordinary tick should stay on the work it exists to do.
 *
 * The sessions delete is the one that was missing entirely rather than merely generous.
 * resolveSession deletes an expired row when that exact session is next presented — so
 * a device that never comes back leaves its row for good, and nothing anywhere swept
 * them. An expired session is unusable by definition, so there is no window to observe.
 */
/**
 * Deletes rollups whose scope no longer exists.
 *
 * `MonthlyRollup.scopeKey` is a composite string — "u:<userId>" or "f:<familyId>" — so
 * there is no foreign key to cascade. Deleting an account or dissolving a family leaves
 * its monthly totals behind, and the 24-month cap above would hold them for two years:
 * on this install 147 of 150 rows belonged to scopes that had already gone.
 *
 * Swept rather than cleared at each delete site, deliberately. A rollup can outlive the
 * reminders it totalled — dissolving a family requires an empty shared list but not an
 * empty history — so the sites are the two account paths *and* both dissolve routes, and
 * a rule that has to be remembered in four places is a rule that will be forgotten in
 * one. This catches every path, including ones nobody has written yet.
 *
 * Reading every id is fine at the scale this app is for; SCALE.md puts the ceiling in
 * the hundreds. The empty-install guard is the important line: `notIn []` matches
 * everything, so a database with no accounts must be left alone rather than emptied.
 */
async function sweepOrphanedRollups(): Promise<number> {
  const [users, families] = await Promise.all([
    prisma.user.findMany({ select: { id: true } }),
    prisma.family.findMany({ select: { id: true } }),
  ]);
  if (users.length === 0) return 0;

  const live = [
    ...users.map((u) => `u:${u.id}`),
    ...families.map((f) => `f:${f.id}`),
  ];
  const { count } = await prisma.monthlyRollup.deleteMany({
    where: { scopeKey: { notIn: live } },
  });
  return count;
}

export interface RetentionSweep {
  ran: boolean;
  notifications: number;
  sessions: number;
  rollups: number;
}

export async function sweepRetention(
  now = new Date(),
  /** Dev-only, so a suite need not wait out an hour for the sampled tick. */
  force = false,
): Promise<RetentionSweep> {
  const idle = { ran: false, notifications: 0, sessions: 0, rollups: 0 };
  if (!force && Math.floor(now.getTime() / 60_000) % 60 !== 0) return idle;
  const day = 24 * 60 * MS_PER_MIN;
  const readCutoff = new Date(now.getTime() - NOTIFICATION_READ_DAYS * day);
  const unreadCutoff = new Date(now.getTime() - NOTIFICATION_UNREAD_DAYS * day);
  // Month starts, so "24 months" is 24 whole months rather than 730 days.
  const rollupCutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - ROLLUP_MONTHS, 1),
  );
  try {
    const [notifications, sessions, rollups] = await Promise.all([
      prisma.notification.deleteMany({
        where: {
          OR: [
            { read: true, createdAt: { lt: readCutoff } },
            { read: false, createdAt: { lt: unreadCutoff } },
          ],
        },
      }),
      prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.monthlyRollup.deleteMany({ where: { month: { lt: rollupCutoff } } }),
    ]);
    const orphans = await sweepOrphanedRollups();
    const rollupCount = rollups.count + orphans;
    if (notifications.count || sessions.count || rollupCount) {
      console.log(
        `[dispatch] swept ${notifications.count} notifications, ${sessions.count} expired sessions, ${rollupCount} rollups`,
      );
    }
    return {
      ran: true,
      notifications: notifications.count,
      sessions: sessions.count,
      rollups: rollupCount,
    };
  } catch (err) {
    console.error("[dispatch] retention sweep failed:", (err as Error).message);
    return idle;
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
      fired: { lead: 0, due: 0, overdue: 0, escalation: 0 },
      skippedAlreadySent: 0,
      notificationsCreated: 0,
      pushesSent: 0,
      pushesFailed: 0,
      pushesSkippedOptOut: 0,
      emailsSent: 0,
      emailsThrottled: 0,
      emailsSkippedOptOut: 0,
      emailsSkippedPlan: 0,
      escalationsWithheld: 0,
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
        <h2 style="margin:0 0 8px;">${escapeHtml(appName)}</h2>
        <p>Hi ${escapeHtml(userName)}, email reminders are working — this is a test.</p>
        <p style="color:#6b7280;font-size:13px;">
          Real reminders arrive when something is due, plus any advance alerts you
          tick on the reminder itself.
        </p>
      </div>`,
  });
}
