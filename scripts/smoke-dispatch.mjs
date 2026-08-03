// Reminder-engine smoke suite:  node --env-file=.env scripts/smoke-dispatch.mjs
//
// Drives /api/cron/dispatch with the dev-only `?now=` override so lead, due and
// overdue alerts can be checked in seconds instead of waiting out real minutes.
// Every assertion is about idempotence or timing — the two things that make a
// scheduler correct and that are invisible until they're wrong.
//
// Needs the dev server running (npm run dev) and CRON_SECRET set.
//
// SAFETY: this fires real notifications for the account it creates, so it
// refuses to run if any device is subscribed to push. It seeds its own throwaway
// account with both channels switched OFF and deletes it afterwards, so it never
// emails or pushes anywhere. Set SMOKE_FORCE=1 to override the device check.

import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SECRET = process.env.CRON_SECRET;
const EMAIL = "smoke-engine@example.invalid";
const TZ = "Asia/Kolkata";

if (!SECRET) {
  console.error("CRON_SECRET is not set — the dispatch endpoint would reject every call.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL ?? "")
    ? undefined
    : { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(`  FAIL ${name}  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const MIN = 60_000;

/** Runs one dispatch tick at a pretended instant. */
async function tick(at) {
  const res = await fetch(
    `${BASE}/api/cron/dispatch?now=${encodeURIComponent(new Date(at).toISOString())}`,
    { headers: { Authorization: `Bearer ${SECRET}` } },
  );
  const body = await res.json();
  if (!res.ok) throw new Error(`dispatch ${res.status}: ${body?.message}`);
  return body;
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

try {
  const subscribed = await prisma.pushSubscription.count({ where: { blockedAt: null } });
  if (subscribed > 0 && process.env.SMOKE_FORCE !== "1") {
    console.error(
      `Refusing to run: ${subscribed} device(s) are subscribed to push, and a dispatch run\n` +
        "would reach a real phone. Re-run with SMOKE_FORCE=1 if that's what you want.",
    );
    process.exit(1);
  }

  await cleanup();

  // Both channels off: the engine still plans and records everything, it just
  // doesn't deliver. That's what makes this safe to run against a live database.
  const user = await prisma.user.create({
    data: {
      name: "Smoke Engine",
      email: EMAIL,
      status: "active",
      role: "member",
      timezone: TZ,
      overdueRepeatMins: 60,
      emailOptIn: false,
      pushOptIn: false,
    },
  });
  const category = await prisma.category.create({
    data: { userId: user.id, name: "Smoke", color: "#3b82f6" },
  });

  const mine = { userId: user.id };
  const countFor = (id, kind) =>
    prisma.reminderDispatch.count({ where: { reminderId: id, kind } });
  const notifs = (id) => prisma.notification.count({ where: { reminderId: id } });

  // The base instant everything is measured from. Fixed and in the future, so the
  // run is deterministic and can never collide with real reminders.
  const DUE = Date.parse("2027-03-10T12:00:00.000Z");
  // createdAt has to sit before the earliest lead point or the engine treats that
  // point as back-fill and skips it — which is the behaviour section 2 checks.
  const CREATED = new Date(DUE - 30 * 24 * 60 * MIN);

  console.log("\n1. Lead, due and overdue fire once each, in order");
  const r1 = await prisma.reminder.create({
    data: {
      ...mine,
      title: "Ladder",
      categoryId: category.id,
      dueAt: new Date(DUE),
      leadOffsets: [1440, 60],
      createdAt: CREATED,
      amount: 500,
    },
  });

  check("nothing before the first lead point", (await tick(DUE - 1441 * MIN)).fired, {
    lead: 0,
    due: 0,
    overdue: 0,
  });
  check("1-day lead fires", (await tick(DUE - 1439 * MIN)).fired.lead, 1);
  check("and does not fire twice", (await tick(DUE - 1438 * MIN)).fired.lead, 0);
  check("1-hour lead fires", (await tick(DUE - 59 * MIN)).fired.lead, 1);
  check("both leads recorded", await countFor(r1.id, "lead"), 2);

  const atDue = await tick(DUE + MIN);
  check("due alert fires", atDue.fired.due, 1);
  check("no overdue yet (interval is 60m)", atDue.fired.overdue, 0);
  check("due alert is not repeated", (await tick(DUE + 2 * MIN)).fired.due, 0);

  console.log("\n2. Overdue nagging respects the interval");
  check("nothing at +59m", (await tick(DUE + 59 * MIN)).fired.overdue, 0);
  check("nags at +61m", (await tick(DUE + 61 * MIN)).fired.overdue, 1);
  check("silent again at +62m", (await tick(DUE + 62 * MIN)).fired.overdue, 0);
  check("nags again at +122m", (await tick(DUE + 122 * MIN)).fired.overdue, 1);
  check("two nags recorded", await countFor(r1.id, "overdue"), 2);
  check("one notification per alert", await notifs(r1.id), 5);

  console.log("\n3. Lead points already past at creation are not back-filled");
  const r2 = await prisma.reminder.create({
    data: {
      ...mine,
      title: "Late add",
      categoryId: category.id,
      // Created now, due in 30 minutes, but asking for a 1-day heads-up.
      dueAt: new Date(DUE + 30 * MIN),
      leadOffsets: [1440],
      createdAt: new Date(DUE),
    },
  });
  check("no instant lead alert", (await tick(DUE + MIN)).fired.lead, 0);
  check("no lead rows at all", await countFor(r2.id, "lead"), 0);

  console.log("\n4. Snoozing silences a reminder, then it resumes");
  const r3 = await prisma.reminder.create({
    data: {
      ...mine,
      title: "Snoozed",
      categoryId: category.id,
      dueAt: new Date(DUE),
      leadOffsets: [],
      createdAt: CREATED,
      snoozedUntil: new Date(DUE + 120 * MIN),
      lastNaggedAt: new Date(DUE + 120 * MIN),
    },
  });
  check("silent while snoozed", await countFor(r3.id, "due"), 0);
  await tick(DUE + 60 * MIN);
  check("still silent mid-snooze", await countFor(r3.id, "due"), 0);
  await tick(DUE + 121 * MIN);
  check("fires once the snooze lapses", await countFor(r3.id, "due"), 1);

  console.log("\n5. A duplicated tick changes nothing");
  const before = await prisma.reminderDispatch.count({
    where: { reminder: mine },
  });
  const repeat = await tick(DUE + 122 * MIN);
  const after = await prisma.reminderDispatch.count({ where: { reminder: mine } });
  check("no new dispatch rows", after, before);
  check("reported as already sent", repeat.skippedAlreadySent > 0, true);

  console.log("\n6. Completing a recurring reminder re-arms it");
  const r4 = await prisma.reminder.create({
    data: {
      ...mine,
      title: "Monthly",
      categoryId: category.id,
      dueAt: new Date(DUE),
      recurrenceRule: "Monthly",
      leadOffsets: [],
      createdAt: CREATED,
    },
  });
  await tick(DUE + MIN);
  check("fires on its first cycle", await countFor(r4.id, "due"), 1);

  // Completion rolls dueAt forward, which gives ReminderDispatch a fresh
  // cycleDueAt — that is what lets the same reminder alert again.
  const nextDue = new Date(DUE);
  nextDue.setUTCMonth(nextDue.getUTCMonth() + 1);
  await prisma.reminder.update({
    where: { id: r4.id },
    data: {
      dueAt: nextDue,
      status: "active",
      snoozedUntil: null,
      lastNaggedAt: null,
      completedAt: null,
    },
  });
  await tick(nextDue.getTime() + MIN);
  check("fires again on the next cycle", await countFor(r4.id, "due"), 2);
  check(
    "the two rows are on different cycles",
    (
      await prisma.reminderDispatch.findMany({
        where: { reminderId: r4.id, kind: "due" },
        select: { cycleDueAt: true },
      })
    ).map((d) => d.cycleDueAt.toISOString()).sort(),
    [new Date(DUE).toISOString(), nextDue.toISOString()].sort(),
  );

  console.log("\n7. Completing a reminder stops it nagging");
  // Measured rather than hard-coded: earlier sections tick a month forward, and
  // while r1 was still active it was right to keep nagging at those instants.
  // What matters is that the count stops moving once it's completed.
  const naggedBefore = await countFor(r1.id, "overdue");
  await prisma.reminder.update({
    where: { id: r1.id },
    data: { status: "completed", completedAt: new Date() },
  });
  const quiet = await tick(DUE + 400 * MIN);
  check("no further nags after completion", await countFor(r1.id, "overdue"), naggedBefore);
  check("the run still reports itself", quiet.ran, true);

  console.log("\n8. Channel opt-outs are honoured");
  // Needs a reminder that actually fires on this tick — the opt-out counters only
  // move when the engine reaches the delivery step for something.
  const r5 = await prisma.reminder.create({
    data: {
      ...mine,
      title: "Opted out",
      categoryId: category.id,
      dueAt: new Date(DUE + 500 * MIN),
      leadOffsets: [],
      createdAt: CREATED,
    },
  });
  const optedOut = await tick(DUE + 501 * MIN);
  check("its due alert fired", optedOut.fired.due >= 1, true);
  check("but it was recorded in the feed", await notifs(r5.id), 1);
  check("nothing pushed", optedOut.pushesSent, 0);
  check("nothing emailed", optedOut.emailsSent, 0);
  check("push skips are counted", optedOut.pushesSkippedOptOut > 0, true);
  check("email skips are counted", optedOut.emailsSkippedOptOut > 0, true);
} finally {
  await cleanup();
  await prisma.$disconnect();
  await pool.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nFailures:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
