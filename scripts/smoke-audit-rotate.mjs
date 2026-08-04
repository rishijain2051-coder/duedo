// Audit rotation smoke suite:  node --env-file=.env scripts/smoke-audit-rotate.mjs
//
// The daily rotation mails the audit log to the main admin and then deletes what it
// mailed. Everything about it is destructive by design, so the one property that
// must hold is: **nothing is deleted unless the mail was accepted.**
//
// This suite is guarded by assertScratchDatabase for a reason that is not
// theoretical. An earlier version of this test tried to provoke a send failure by
// pointing the dump at an address on a reserved `.invalid` domain, assuming the SMTP
// server would reject it. It did not — the message was accepted at submission and
// would have bounced later — so the send "succeeded", the delete went ahead, and
// 188 rows of a real audit log were destroyed by the test written to prove they
// wouldn't be. The failure is now forced explicitly via ?failAuditMail=1, and this
// file refuses to run anywhere with real accounts in it.

import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertScratchDatabase } from "./smoke-guard.mjs";

const BASE = process.env.BASE_URL || "http://localhost:3000";

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

async function cleanup() {
  await prisma.activityLog.deleteMany({});
  await prisma.user.deleteMany({ where: { email: ADMIN } });
}

async function seedLog(n) {
  await prisma.activityLog.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      action: "user.login",
      entity: "user",
      detail: { seq: i, note: 'text with a comma, and a "quote"' },
    })),
  });
}

await assertScratchDatabase(prisma);

try {
  await cleanup();

  // The rotation sends to the earliest-created active admin.
  await prisma.user.create({
    data: {
      email: ADMIN,
      name: "Rotate Admin",
      role: "admin",
      status: "active",
      timezone: "Asia/Kolkata",
      emailOptIn: false,
      pushOptIn: false,
    },
  });

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n1. A failed send deletes nothing");
  await seedLog(25);
  check("seeded", await prisma.activityLog.count(), 25);

  const failed = await tick("?failAuditMail=1");
  check("the rotation reports it did not run", failed.audit?.ran, false);
  check(
    "and says the mail was the problem",
    /could not be emailed/.test(failed.audit?.reason ?? ""),
    true,
  );
  check("every row survived", await prisma.activityLog.count(), 25);
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
  check("and the log is untouched", await prisma.activityLog.count(), 25);
  check("while dispatch still time-travelled", travelled.ran, true);

  console.log("\n3. Retrying after a failure still has everything to send");
  const failedAgain = await tick("?failAuditMail=1");
  check("still refuses to delete", failedAgain.audit?.ran, false);
  check("rows intact after a second failure", await prisma.activityLog.count(), 25);

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n4. A successful send clears what it mailed");
  // Opt-in, because this section sends a real email through the configured SMTP
  // account. Anything that leaves the machine should be a deliberate choice rather
  // than a side effect of running the tests.
  if (process.env.ROTATE_ALLOW_REAL_MAIL !== "1") {
    console.log(
      "     skipped — set ROTATE_ALLOW_REAL_MAIL=1 to let this section send a real email",
    );
    check("nothing was deleted while the success path was skipped",
      await prisma.activityLog.count(), 25);
  } else {
  const ok = await tick();
  const mailWorks = ok.audit?.ran === true;
  if (!mailWorks) {
    check(
      "without SMTP it declines rather than deleting",
      /not configured|could not be emailed/.test(ok.audit?.reason ?? ""),
      true,
    );
    check("and the log is still whole", await prisma.activityLog.count(), 25);
    console.log("     (SMTP unavailable here — the success path below is skipped)");
  } else {
    check("it reports the rows it mailed", ok.audit?.rowsMailed, 25);
    check("and deleted the same number", ok.audit?.rowsDeleted, 25);
    check("addressed to the main admin", ok.audit?.mailedTo, ADMIN);
    // What's left is the marker, and only the marker.
    const left = await prisma.activityLog.findMany();
    check("one row remains", left.length, 1);
    check("and it records the rotation", left[0]?.action, "audit.rotate");
    check("naming where the history went", left[0]?.detail?.mailedTo, ADMIN);

    console.log("\n5. It happens once a day, not once a minute");
    const again = await tick();
    check("a later tick the same day is skipped", again.audit?.ran, false);
    check("for the right reason", again.audit?.reason, "already rotated today");
    check("and the marker is not duplicated", await prisma.activityLog.count(), 1);

    console.log("\n6. Entries written after the cutoff are kept for tomorrow");
    await seedLog(3);
    const afterNew = await tick();
    check("today is still done", afterNew.audit?.ran, false);
    check("so the new entries stay", await prisma.activityLog.count(), 4);
  }
  }
} finally {
  await cleanup();
  await prisma.$disconnect();
  await pool.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
