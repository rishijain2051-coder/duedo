// Audit rotation smoke suite:  node --env-file=.env scripts/smoke-audit-rotate.mjs
//
// The daily rotation mails the audit log to the main admin and then deletes what it
// mailed. Everything about it is destructive by design, so the one property that
// must hold is: **nothing is deleted unless the mail was accepted.**
//
// This suite is guarded three ways, for a reason that is not theoretical. An earlier
// version tried to provoke a send failure by pointing the dump at an address on a
// reserved `.invalid` domain, assuming the SMTP server would reject it. It did not —
// the message was accepted at submission and would have bounced later — so the send
// "succeeded", the delete went ahead, and 188 rows of a real audit log were destroyed
// by the test written to prove they wouldn't be. Now:
//
//   1. the failure is forced explicitly via ?failAuditMail=1;
//   2. assertScratchDatabase refuses to run anywhere with real accounts in it;
//   3. every existing log row is copied out before anything runs and put back
//      afterwards, so even SMOKE_FORCE=1 cannot cost anyone their history.
//
// The third is the one that would have saved those 188 rows. A guard you can override
// is a guard that will be overridden.
//
// One known flake, and only under SMOKE_FORCE=1 against the live database: rotation
// happens once a day, and production's own cron tick shares this database. If a real tick
// lands between this suite's cleanup and section 4, it writes the day's marker first and
// section 4 correctly reports "already rotated today". Re-run it. Pointing DATABASE_URL at
// a scratch database — which is what the guard is asking for — removes the race entirely.

import { Prisma, PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertScratchDatabase } from "./smoke-guard.mjs";

const BASE = process.env.BASE_URL || "http://localhost:3000";

/**
 * Read from the source rather than restated here. The suite asserts an exact number
 * of deletions, so a copy of this would turn "somebody tuned the tail" into a test
 * failure that looks like a bug in the rotation.
 */
const KEEP = Number(
  readFileSync(new URL("../lib/audit-rotate.ts", import.meta.url), "utf8").match(
    /AUDIT_TAIL_KEEP = (\d+)/,
  )[1],
);
/** Enough over the tail that the trim has something to remove. */
const SEEDED = KEEP + 12;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL ?? "")
    ? undefined
    : { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const ADMIN = "rotate-admin@example.invalid";

let passed = 0;
const failures = [];
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(`  FAIL ${name}  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const tick = (query = "") =>
  fetch(`${BASE}/api/cron/dispatch${query}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  }).then((r) => r.json());

/** Whatever was in the log before this suite touched it. */
let held = [];

async function holdRealLog() {
  held = await prisma.activityLog.findMany({ orderBy: { timestamp: "asc" } });
}

async function cleanup() {
  await prisma.activityLog.deleteMany({});
  await prisma.user.deleteMany({ where: { email: ADMIN } });
}

/**
 * Puts the original rows back, ids and timestamps included, so the restored log is the
 * same log and not a copy of it. `detail` needs DbNull explicitly: Prisma rejects a
 * plain null on a Json column rather than treating it as "no value".
 */
async function releaseRealLog() {
  await prisma.activityLog.deleteMany({});
  if (held.length === 0) return;
  await prisma.activityLog.createMany({
    data: held.map((r) => ({ ...r, detail: r.detail ?? Prisma.DbNull })),
    skipDuplicates: true,
  });
}

/**
 * Distinct timestamps, one second apart, ending a minute ago.
 *
 * Explicit rather than left to the default, because Postgres' `now()` is
 * transaction-start time: a createMany stamps every row with the same instant, and
 * "keep the newest 50" then has no defined answer. The assertions about *which* rows
 * survive the trim would pass or fail on physical row order.
 */
async function seedLog(n) {
  const base = Date.now() - (n + 60) * 1000;
  await prisma.activityLog.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      action: "user.login",
      entity: "user",
      timestamp: new Date(base + i * 1000),
      detail: { seq: i, note: 'text with a comma, and a "quote"' },
    })),
  });
}

/** Entries landing now, i.e. after a rotation that has already happened today. */
async function seedLogNow(n) {
  await prisma.activityLog.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      action: "user.login",
      entity: "user",
      detail: { seq: `late-${i}` },
    })),
  });
}

await assertScratchDatabase(prisma);
await holdRealLog();

try {
  await cleanup();

  // The dump goes to the install's owner — the account holding isRootAdmin.
  await prisma.user.create({
    data: {
      email: ADMIN,
      name: "Rotate Admin",
      role: "admin",
      isRootAdmin: true,
      status: "active",
      timezone: "Asia/Kolkata",
      emailOptIn: false,
      pushOptIn: false,
    },
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n1. A failed send deletes nothing");
  await seedLog(SEEDED);
  check("seeded", await prisma.activityLog.count(), SEEDED);

  const failed = await tick("?failAuditMail=1");
  check("the rotation reports it did not run", failed.audit?.ran, false);
  check(
    "and says the mail was the problem",
    /could not be emailed/.test(failed.audit?.reason ?? ""),
    true,
  );
  check("every row survived", await prisma.activityLog.count(), SEEDED);
  check("no rotation marker was written",
    await prisma.activityLog.count({ where: { action: "audit.rotate" } }), 0);
  check("dispatch itself was unaffected", failed.ran, true);

  console.log("\n2. Time travel never triggers a real rotation");
  // ?now= exists so the engine's lead/due/overdue spacing can be tested without
  // waiting out real minutes. The dispatch suite drives it months ahead, which once
  // convinced the rotation a new day had turned — it mailed a dump to the live admin
  // and cleared the log. Sending is dedupe-guarded and survives time travel; mailing
  // the owner and deleting an audit trail do not.
  const future = new Date(Date.now() + 400 * 24 * 3600_000).toISOString();
  const travelled = await tick(`?now=${encodeURIComponent(future)}`);
  check("the rotation stands down", travelled.audit?.ran, false);
  check("saying why", travelled.audit?.reason, "skipped: the clock is overridden");
  check("and the log is untouched", await prisma.activityLog.count(), SEEDED);
  check("while dispatch still time-travelled", travelled.ran, true);

  console.log("\n3. Retrying after a failure still has everything to send");
  const failedAgain = await tick("?failAuditMail=1");
  check("still refuses to delete", failedAgain.audit?.ran, false);
  check("rows intact after a second failure", await prisma.activityLog.count(), SEEDED);

  console.log("\n   the two overrides are mutually exclusive");
  const both = await fetch(
    `${BASE}/api/cron/dispatch?failAuditMail=1&fakeAuditMail=1`,
    { method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } },
  );
  check("asking for both is a 400", both.status, 400);

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n4. A successful send mails everything and keeps the newest few");
  // ?fakeAuditMail=1 reports a successful send without sending, which is the only way
  // to reach the delete path. This used to be opt-in behind ROTATE_ALLOW_REAL_MAIL,
  // which meant the branch that actually removes rows was never covered by a normal
  // run — and it could not be: the test admin's address is on a reserved domain, and
  // lib/mail.ts refuses those, so the real sender always reports failure here.
  const ok = await tick("?fakeAuditMail=1");
  check("the rotation ran", ok.audit?.ran, true);
  {
    check("every row went into the dump", ok.audit?.rowsMailed, SEEDED);
    check("only the surplus was trimmed", ok.audit?.rowsDeleted, SEEDED - KEEP);
    check("the tail was kept", ok.audit?.keptTail, KEEP);
    // Asserted as the rule, not as a literal address. Under SMOKE_FORCE=1 the real
    // owner is still in the table alongside this suite's admin, and the dump belongs
    // to whoever the rule picks — root first, then oldest. Matching that ordering here
    // is what makes the check mean the same thing in a scratch database and in a
    // forced run.
    const owner = await prisma.user.findFirst({
      where: { role: "admin", status: "active" },
      orderBy: [{ isRootAdmin: "desc" }, { createdAt: "asc" }],
      select: { email: true },
    });
    check("addressed to the install's owner", ok.audit?.mailedTo, owner?.email ?? ADMIN);
    // The tail, plus the marker recording what happened to the rest.
    const left = await prisma.activityLog.findMany({ orderBy: { timestamp: "desc" } });
    check("the log is the tail plus the marker", left.length, KEEP + 1);
    check("the marker is the newest row", left[0]?.action, "audit.rotate");
    check(
      "naming where the history went",
      left[0]?.detail?.mailedTo,
      owner?.email ?? ADMIN,
    );
    // The point of a tail: an admin opening the page still sees recent activity.
    check(
      "and the entries under it are the newest, not the oldest",
      left[1]?.detail?.seq,
      SEEDED - 1,
    );

    console.log("\n5. It happens once a day, not once a minute");
    const again = await tick("?fakeAuditMail=1");
    check("a later tick the same day is skipped", again.audit?.ran, false);
    check("for the right reason", again.audit?.reason, "already rotated today");
    check("nothing further was trimmed", await prisma.activityLog.count(), KEEP + 1);

    console.log("\n6. Entries written after the cutoff are kept for tomorrow");
    await seedLogNow(3);
    const afterNew = await tick("?fakeAuditMail=1");
    check("today is still done", afterNew.audit?.ran, false);
    check("so the new entries stay", await prisma.activityLog.count(), KEEP + 4);
  }
} finally {
  await cleanup();
  await releaseRealLog();
  await prisma.$disconnect();
  await pool.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
