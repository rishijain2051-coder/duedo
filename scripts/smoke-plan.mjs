// Plans and caps smoke suite:
//   node --env-file=.env scripts/smoke-plan.mjs
//
// The only suite that seeds *free* accounts on purpose — everything else spreads PAID
// from smoke-guard.mjs, because everything else is testing a feature rather than a
// paywall.
//
// Three things are under test, in descending order of how much they matter.
//
// The one that matters most is what a lapse does NOT do. A billing state that could
// stop a reminder firing would be the worst failure this app has, and it is invisible
// from the outside: everything looks fine, and somebody misses their medication. §6
// runs the real dispatcher against a lapsed account and asserts the alert still fires
// and the row still exists.
//
// Then the caps themselves, including the door that does not go through the form:
// POST /api/ingest/reminder is a create path, and a paywall that only exists in the UI
// is not a paywall.
//
// Then the grant: root-only, stacking from the later of today and the current expiry,
// and refusing a date without a plan behind it.

import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHmac, randomBytes } from "node:crypto";
import { assertScratchDatabase, SESSION_COOKIE, TOKEN_PREFIX } from "./smoke-guard.mjs";

const BASE = process.env.BASE_URL || "http://localhost:3000";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL ?? "")
    ? undefined
    : { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const FREE = "plan-free@example.invalid";
const PAY = "plan-paid@example.invalid";
const OWNER = "plan-owner@example.invalid";
const JOINER = "plan-joiner@example.invalid";
const EMAILS = [FREE, PAY, OWNER, JOINER];
const FAMILY = "Plan Household";

const DAY = 86_400_000;

/** Kept in step with lib/plan.ts by assertion, not by faith — see §1. */
const FREE_REMINDERS = 25;
const FREE_CATEGORIES = 15;

let passed = 0;
const failures = [];
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(
      `  FAIL ${name}  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function session() {
  let cookie = "";
  return async function call(method, path, body, headers = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(";")[0];
      if (pair.startsWith(`${SESSION_COOKIE}=`)) cookie = pair;
    }
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };
}

/**
 * A plain tick — no mail overrides, deliberately.
 *
 * `?fakeAuditMail=1` would keep the owner's inbox quiet, and it is the wrong tool
 * here. It makes a send *report success without sending*, and on a database that also
 * carries real data the audit rotation then deletes a day of history no mail carried.
 * That is not hypothetical: sharing a force flag with a faked sender cost this install
 * 7,156 rows of pg_cron history once already.
 *
 * So this sends for real. The cost is that §11 mails the install's owner one renewal
 * digest naming a test account, which is a message to ignore rather than history to
 * lose.
 */
const tick = () =>
  fetch(`${BASE}/api/cron/dispatch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  }).then((r) => r.json());

async function cleanup() {
  await prisma.family.deleteMany({ where: { name: FAMILY } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}

/** Signs up, activates and logs in. Free unless `plan` is passed. */
async function account(email, name, pin, extra = {}) {
  const s = session();
  await s("POST", "/api/auth/register", { name, email, pin, accountType: "family" });
  await prisma.user.update({
    where: { email },
    data: {
      status: "active",
      role: "member",
      emailVerifiedAt: new Date(),
      emailOptIn: false,
      pushOptIn: false,
      timezone: "Asia/Kolkata",
      ...extra,
    },
  });
  await s("POST", "/api/auth/login", { email, pin });
  const row = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return { call: s, id: row.id, email };
}

/** Reminders written straight to the table — the cap is checked on the route, not here. */
async function seedReminders(userId, categoryId, n, status = "active") {
  await prisma.reminder.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      userId,
      categoryId,
      title: `Seeded ${i}`,
      dueAt: new Date(Date.now() + (i + 2) * DAY),
      hasTime: true,
      status,
    })),
  });
}

await assertScratchDatabase(prisma);

try {
  await cleanup();

  const free = await account(FREE, "Plan Free", "1111");
  const paid = await account(PAY, "Plan Paid", "2222", {
    plan: "family",
    premiumUntil: new Date(Date.now() + 200 * DAY),
  });
  const joiner = await account(JOINER, "Plan Joiner", "4444");
  const owner = await account(OWNER, "Plan Owner", "3333", {
    role: "admin",
    isRootAdmin: true,
  });

  const freeCat = (await free.call("GET", "/api/categories")).data[0];
  const paidCat = (await paid.call("GET", "/api/categories")).data[0];

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n1. A new account starts free, and the seeded categories don't breach the cap");
  const settings = (await free.call("GET", "/api/settings")).data;
  check("plan is free", settings.plan, "free");
  check("no expiry", settings.premiumUntil, null);
  // DEFAULT_CATEGORIES seeds 8 and ensureOthersCategory adds a 9th on first save. A cap
  // at or below 9 would refuse a brand new account its own starting list.
  const seeded = await prisma.category.count({ where: { userId: free.id } });
  check("seeded categories are under the free cap", seeded < FREE_CATEGORIES, true);

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n2. Paid-only features are refused with 402, not 403");
  check("spending", (await free.call("GET", "/api/insights")).status, 402);
  check("yearly spending", (await free.call("GET", "/api/insights/year")).status, 402);
  check("spending export", (await free.call("GET", "/api/insights/export")).status, 402);
  check("voice token", (await free.call("POST", "/api/settings/api-token")).status, 402);
  check(
    "outside contacts",
    (await free.call("POST", "/api/contacts", { email: "landlord@example.invalid" })).status,
    402,
  );
  check(
    "creating a family",
    (await free.call("POST", "/api/families", { name: FAMILY })).status,
    402,
  );
  // The refusal has to name a way out, or it is just a wall.
  const refusal = (await free.call("GET", "/api/insights")).data.message;
  check("refusal names a plan", /Individual|Family/.test(refusal), true);

  console.log("\n   …and allowed on a paid account");
  check("spending", (await paid.call("GET", "/api/insights")).status, 200);
  check("voice token", (await paid.call("POST", "/api/settings/api-token")).status, 201);
  check(
    "outside contacts",
    (await paid.call("POST", "/api/contacts", { email: "landlord@example.invalid" })).status,
    201,
  );
  check("creating a family", (await paid.call("POST", "/api/families", { name: FAMILY })).status, 201);

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n3. The reminder cap counts live rows, and completing one frees a slot");
  await seedReminders(free.id, freeCat.id, FREE_REMINDERS - 1);
  const lastFree = await free.call("POST", "/api/reminders", {
    title: "The 25th",
    dueAt: "2027-03-01",
  });
  check("the one that fits is created", lastFree.status, 201);
  const overCap = await free.call("POST", "/api/reminders", {
    title: "The 26th",
    dueAt: "2027-03-01",
  });
  check("the next one is refused", overCap.status, 402);
  check("and says how many are live", /25/.test(overCap.data.message), true);

  // Completed and archived rows are not live, so they must not occupy a slot.
  await prisma.reminder.update({
    where: { id: lastFree.data.id },
    data: { status: "completed", completedAt: new Date() },
  });
  check(
    "completing one makes room again",
    (await free.call("POST", "/api/reminders", { title: "Replacement", dueAt: "2027-03-01" }))
      .status,
    201,
  );

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n4. The voice route enforces the same cap — a paywall only in the UI is none");
  // A token minted while paid, then the account dropped to free: the token never
  // expires by design, so this is the state a lapse actually leaves behind.
  const plain = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const hash = createHmac("sha256", process.env.AUTH_SECRET || "dev-insecure-secret-change-me")
    .update(plain)
    .digest("hex");
  await prisma.user.update({
    where: { id: free.id },
    data: { apiTokenHash: hash, apiTokenCreatedAt: new Date() },
  });

  const ingest = (body, token = plain) =>
    fetch(`${BASE}/api/ingest/reminder`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, data: await r.json() }));

  const spoken = await ingest({ text: "remind me to call the bank at 4pm" });
  check("a free account's shortcut is refused", spoken.status, 402);
  // It is answered out loud, because a shortcut that fails silently is the failure
  // this endpoint was built to avoid.
  check("and says so aloud", typeof spoken.data.spoken === "string", true);

  await prisma.user.update({
    where: { id: free.id },
    data: { plan: "individual", premiumUntil: new Date(Date.now() + 30 * DAY) },
  });
  const overCapPaid = await ingest({ text: "remind me to call the bank at 4pm" });
  check("upgrading lets the same shortcut through", overCapPaid.status, 201);

  // Back to free, and over the reminder cap: the cap must bite on this route too.
  await prisma.user.update({
    where: { id: free.id },
    data: { plan: "family", premiumUntil: new Date(Date.now() + 30 * DAY) },
  });
  await seedReminders(free.id, freeCat.id, 210);
  const paidOverCap = await ingest({ text: "remind me to water the plants at 5pm" });
  check("even a paid account has a ceiling on the voice route", paidOverCap.status, 402);
  await prisma.reminder.deleteMany({ where: { userId: free.id, title: { startsWith: "Seeded" } } });

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n5. Family seats are charged to the head, not the joiner");
  const fam = (await paid.call("GET", "/api/families")).data[0];
  check(
    "a free account may still join a paid family",
    (await joiner.call("POST", "/api/families/join", { joinCode: fam.joinCode })).status,
    201,
  );
  // The head lapses. Existing members stay — nothing is taken away — but the fifth
  // seat is refused.
  await prisma.user.update({
    where: { id: paid.id },
    data: { premiumUntil: new Date(Date.now() - DAY) },
  });
  const stranger = await account("plan-stranger@example.invalid", "Plan Stranger", "5555");
  EMAILS.push("plan-stranger@example.invalid");
  const refusedSeat = await stranger.call("POST", "/api/families/join", {
    joinCode: fam.joinCode,
  });
  check("a lapsed head can't take a new member", refusedSeat.status, 402);
  // And it does not say why, because whoever typed a join code is often a stranger to
  // the head's billing.
  check("without naming their billing", /paid|plan|expired/i.test(refusedSeat.data.message), false);
  check(
    "the members already in stay in",
    await prisma.familyMember.count({ where: { familyId: fam.id } }),
    2,
  );

  // ──────────────────────────────────────────────────────────────────────────────
  // The assertion this whole suite exists for.
  console.log("\n6. A lapse never stops a reminder firing");
  await prisma.user.update({
    where: { id: paid.id },
    data: { plan: "family", premiumUntil: new Date(Date.now() - 10 * DAY), pushOptIn: false },
  });
  const dueNow = await prisma.reminder.create({
    data: {
      userId: paid.id,
      categoryId: paidCat.id,
      title: "Lapsed but still due",
      dueAt: new Date(Date.now() - 60_000),
      hasTime: true,
      status: "active",
    },
  });
  const ran = await tick();
  check("the dispatcher ran", ran.ran, true);
  const fired = await prisma.reminderDispatch.count({
    where: { reminderId: dueNow.id, userId: paid.id },
  });
  check("the lapsed account's reminder fired", fired > 0, true);
  const feed = await prisma.notification.count({ where: { userId: paid.id } });
  check("and reached their in-app feed", feed > 0, true);
  check(
    "the reminder itself is untouched",
    (await prisma.reminder.findUnique({ where: { id: dueNow.id }, select: { status: true } }))
      .status,
    "active",
  );

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n7. Email is the channel that lapses, and it is counted as such");
  await prisma.user.update({
    where: { id: paid.id },
    data: { emailOptIn: true, plan: "family", premiumUntil: new Date(Date.now() - DAY) },
  });
  await prisma.reminderDispatch.deleteMany({ where: { reminderId: dueNow.id } });
  const lapsedTick = await tick();
  check("skipped for the plan", lapsedTick.emailsSkippedPlan > 0, true);
  // Measured on the row rather than on the summary counter. Other accounts share this
  // database and their opt-outs land in the same tally, so `emailsSkippedOptOut === 0`
  // would be an assertion about them and not about this.
  const rowsFor = await prisma.reminderDispatch.findMany({
    where: { reminderId: dueNow.id, userId: paid.id },
    select: { emailedAt: true },
  });
  check("their alert fired", rowsFor.length > 0, true);
  // The whole distinction: opted in, alerted, and simply not emailed.
  check(
    "and none of it was emailed",
    rowsFor.every((r) => r.emailedAt === null),
    true,
  );

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n8. Granting is the owner's alone, and stacks from the later date");
  check(
    "a member can't grant themselves a plan",
    (await free.call("PATCH", `/api/users/${free.id}`, { plan: "family", addDays: 365 })).status,
    403,
  );
  check(
    "nor can a plain admin — only the root row",
    (await paid.call("PATCH", `/api/users/${free.id}`, { plan: "family", addDays: 365 })).status,
    403,
  );

  // Lapsed ten days ago: a year must run from today, not from a date already past.
  await prisma.user.update({
    where: { id: free.id },
    data: { plan: "free", premiumUntil: new Date(Date.now() - 10 * DAY) },
  });
  const granted = await owner.call("PATCH", `/api/users/${free.id}`, {
    plan: "individual",
    addDays: 365,
    planNote: "UPI 4471, 99, 1yr",
  });
  check("the owner may grant", granted.status, 200);
  const daysOut = Math.round((new Date(granted.data.premiumUntil) - Date.now()) / DAY);
  check("a lapsed account restarts from today", daysOut, 365);
  check("the note is kept", granted.data.planNote, "UPI 4471, 99, 1yr");

  // Renewing early keeps what is left.
  const extended = await owner.call("PATCH", `/api/users/${free.id}`, { addDays: 365 });
  check(
    "renewing early stacks rather than resets",
    Math.round((new Date(extended.data.premiumUntil) - Date.now()) / DAY),
    730,
  );

  check(
    "a date with no plan behind it is refused",
    (await owner.call("PATCH", `/api/users/${joiner.id}`, { addDays: 30 })).status,
    400,
  );
  check(
    "an unknown plan is refused",
    (await owner.call("PATCH", `/api/users/${joiner.id}`, { plan: "platinum", addDays: 30 }))
      .status,
    400,
  );
  check(
    "and a decade-plus grant is a typo, not a decision",
    (await owner.call("PATCH", `/api/users/${joiner.id}`, { plan: "family", addDays: 99999 }))
      .status,
    400,
  );

  // The owner can grant to their own row — the self rule protects against lockout,
  // which extending access cannot cause.
  check(
    "the owner may grant to themselves",
    (await owner.call("PATCH", `/api/users/${owner.id}`, { plan: "family", addDays: 365 })).status,
    200,
  );

  console.log("\n9. Every grant leaves a paper trail");
  const trail = await prisma.activityLog.findMany({
    where: { action: "plan.grant", entityId: free.id },
    orderBy: { timestamp: "asc" },
    select: { detail: true },
  });
  check("both grants recorded", trail.length, 2);
  check("with the date it moved from", trail[1].detail.from !== null, true);
  check("and the date it moved to", trail[1].detail.to !== null, true);

  console.log("\n10. Withdrawing puts them back on free without touching their data");
  const before = await prisma.reminder.count({ where: { userId: free.id } });
  check(
    "withdrawn",
    (await owner.call("PATCH", `/api/users/${free.id}`, { clearPremium: true })).status,
    200,
  );
  const after = await prisma.user.findUnique({
    where: { id: free.id },
    select: { plan: true, premiumUntil: true },
  });
  check("back to free", after.plan, "free");
  check("with no expiry left over", after.premiumUntil, null);
  check("and every reminder still there", await prisma.reminder.count({ where: { userId: free.id } }), before);

  console.log("\n11. Renewal warnings fire once per grant, not once per minute");
  await prisma.activityLog.deleteMany({ where: { action: "plan.expiring", entityId: paid.id } });
  await prisma.notification.deleteMany({ where: { userId: paid.id } });
  await prisma.user.update({
    where: { id: paid.id },
    data: { plan: "family", premiumUntil: new Date(Date.now() + 2 * DAY) },
  });
  const warn1 = await tick();
  check("warned", warn1.expiring.warned >= 1, true);
  check(
    "and told them in the app",
    await prisma.notification.count({
      where: { userId: paid.id, title: { contains: "ends in" } },
    }),
    1,
  );
  const warn2 = await tick();
  check("a second tick doesn't warn again", warn2.expiring.warned, 0);
} finally {
  await cleanup();
  await prisma.$disconnect();
  await pool.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
