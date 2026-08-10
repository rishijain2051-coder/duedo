// Spending insights smoke suite:
//   node --env-file=.env scripts/smoke-insights.mjs
//
// Two things are under test, and only one of them is arithmetic.
//
// The arithmetic: totals, per-category breakdown, the trend's refusal to report on one
// month of data, the forecast, and the CSV.
//
// The part that matters more: these routes read ReminderHistory, not Reminder, so they do
// not pass through lib/ownership.ts at all. "What did this household spend on medical
// bills" is exactly as private as the reminders behind it, and a missing clause here
// leaks money rather than throwing. Every isolation assertion below exists because
// nothing else in the app would have caught it.
//
// It also covers the month close and the history prune, whose one inviolable rule is that
// a month with no rollup is never pruned — if the close failed, the detail is the only
// copy left.

import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertScratchDatabase, PAID, SESSION_COOKIE } from "./smoke-guard.mjs";

const BASE = process.env.BASE_URL || "http://localhost:3000";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL ?? "")
    ? undefined
    : { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const ANN = "insight-ann@example.invalid";
const BEN = "insight-ben@example.invalid";
const CAS = "insight-cas@example.invalid";
const FAMILY = "Insight Household";

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

function session() {
  let cookie = "";
  return async function call(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
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
      data = text; // the CSV route
    }
    return { status: res.status, data, headers: res.headers };
  };
}

const tick = (query = "") =>
  fetch(`${BASE}/api/cron/dispatch${query}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  }).then((r) => r.json());

const scopeKeys = [];

async function cleanup() {
  await prisma.family.deleteMany({ where: { name: FAMILY } });
  await prisma.user.deleteMany({ where: { email: { in: [ANN, BEN, CAS] } } });
  if (scopeKeys.length > 0) {
    await prisma.monthlyRollup.deleteMany({ where: { scopeKey: { in: scopeKeys } } });
  }
}

/** Signs up, activates, logs in. Returns the caller and the account id. */
async function account(email, name, pin) {
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
      // Spending is a paid surface; these accounts exist to test the arithmetic.
      ...PAID,
    },
  });
  await s("POST", "/api/auth/login", { email, pin });
  const row = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return { call: s, id: row.id };
}

/** A completion in the past, written directly — the routes can only complete "now". */
async function history(reminderId, completedOn, amount, cycleDueAt = completedOn) {
  await prisma.reminderHistory.create({
    data: { reminderId, completedOn, cycleDueAt, amount, status: "completed" },
  });
}

function monthsAgo(n) {
  const d = new Date();
  // Day 15, so a month-boundary timezone shift can't move it into a neighbouring month
  // and make the assertions depend on when the suite happens to run.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 15, 6, 0, 0));
}

await assertScratchDatabase(prisma);

try {
  await cleanup();

  const ann = await account(ANN, "Insight Ann", "1111");
  const ben = await account(BEN, "Insight Ben", "2222");
  const cas = await account(CAS, "Insight Cas", "3333");
  const anon = session();

  scopeKeys.push(`u:${ann.id}`, `u:${ben.id}`, `u:${cas.id}`);

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n1. Anonymous callers get nothing");
  check("GET /api/insights", (await anon("GET", "/api/insights")).status, 401);
  check("GET /api/insights/year", (await anon("GET", "/api/insights/year")).status, 401);
  check("GET /api/insights/export", (await anon("GET", "/api/insights/export")).status, 401);

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n2. Personal totals are this account's own");
  const annCat = (await ann.call("GET", "/api/categories")).data[0];
  const rentId = (
    await ann.call("POST", "/api/reminders", {
      title: "Ann rent",
      categoryId: annCat.id,
      dueAt: "2026-12-01",
      amount: 12000,
    })
  ).data.id;
  const billId = (
    await ann.call("POST", "/api/reminders", {
      title: "Ann electricity",
      categoryId: annCat.id,
      dueAt: "2026-12-02",
      amount: 1500,
    })
  ).data.id;

  const now = new Date();
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2, 6, 0, 0));
  await history(rentId, thisMonth, 12000);
  await history(billId, thisMonth, 1500.5);

  const annMonth = (await ann.call("GET", "/api/insights")).data;
  check("total is the sum of both", annMonth.spent, 13500.5);
  check("two completions", annMonth.completions, 2);
  check("one category", annMonth.categories.length, 1);
  check("named", annMonth.categories[0].name, annCat.name);

  console.log("\n   and invisible to everyone else");
  check("Ben's total is zero", (await ben.call("GET", "/api/insights")).data.spent, 0);
  check(
    "Ben's category list is empty",
    (await ben.call("GET", "/api/insights")).data.categories.length,
    0,
  );

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n3. A trend needs more than one month behind it");
  check("no trend from this month alone", annMonth.categories[0].trend, null);
  check("and it says how little it has", annMonth.categories[0].baselineMonths, 0);

  // Two complete months of baseline: 1000 and 3000, mean 2000. This month is 13500.50.
  await history(rentId, monthsAgo(1), 1000);
  await history(rentId, monthsAgo(2), 3000);
  const withTrend = (await ann.call("GET", "/api/insights")).data;
  check("now there is a baseline", withTrend.categories[0].baselineMonths, 2);
  check("and a percentage against it", withTrend.categories[0].trend, 575);

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n4. On-time uses the cycle, not the current dueAt");
  // Late by a day against its own cycle, which is the only way to know after a
  // recurring reminder has rolled forward.
  //
  // Its cycle is deliberately a *different* day from the on-time row this reminder
  // already has. ReminderHistory is unique on (reminderId, cycleDueAt) — one reminder
  // settles any given cycle at most once — so reusing thisMonth here would be seeding
  // a pair of rows the app itself can no longer produce.
  const lateCycle = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 6, 0, 0));
  const lateOn = new Date(lateCycle.getTime() + 86_400_000);
  await history(billId, lateOn, 500, lateCycle);
  // Three completions carry a cycle this month: two on their date, one a day after.
  const onTime = (await ann.call("GET", "/api/insights")).data.onTime;
  check("two of the three met their date", onTime.met, 2);
  check("out of three judged", onTime.of, 3);

  console.log("\n   a completion with no recorded cycle is not counted as late");
  await prisma.reminderHistory.create({
    data: { reminderId: billId, completedOn: thisMonth, cycleDueAt: null, amount: 0, status: "completed" },
  });
  const stillThree = (await ann.call("GET", "/api/insights")).data.onTime;
  check("still three judged", stillThree.of, 3);
  check("still two met", stillThree.met, 2);

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n5. Family scope is the shared list, not anyone's private spend");
  const fam = (await ann.call("POST", "/api/families", { name: FAMILY })).data;
  scopeKeys.push(`f:${fam.id}`);
  const joined = await ben.call("POST", "/api/families/join", { joinCode: fam.joinCode });
  check("Ben joined the family", joined.status, 201);

  const famCat = (await ann.call("GET", `/api/categories?scope=${fam.id}`)).data[0];
  const sharedId = (
    await ann.call("POST", "/api/reminders", {
      title: "Shared water bill",
      categoryId: famCat.id,
      dueAt: "2026-12-05",
      amount: 800,
      familyId: fam.id,
      audience: "family",
    })
  ).data.id;
  await history(sharedId, thisMonth, 800);

  const famView = (await ann.call("GET", `/api/insights?scope=${fam.id}`)).data;
  check("the family total is the shared list only", famView.spent, 800);
  check(
    "Ben sees the same family total",
    (await ben.call("GET", `/api/insights?scope=${fam.id}`)).data.spent,
    800,
  );
  check(
    "Ben's personal total does not include it",
    (await ben.call("GET", "/api/insights")).data.spent,
    0,
  );
  check(
    "nor does Ann's, even though she created it",
    (await ann.call("GET", "/api/insights")).data.spent,
    // 12000 + 1500.50 + the 500 late payment from section 4 + a 0 with no cycle.
    14000.5,
  );

  console.log("\n   and a non-member cannot ask about it");
  check(
    "Cas gets 404 for the family scope",
    (await cas.call("GET", `/api/insights?scope=${fam.id}`)).status,
    404,
  );
  check(
    "404 from the year view too",
    (await cas.call("GET", `/api/insights/year?scope=${fam.id}`)).status,
    404,
  );
  check(
    "and from the export",
    (await cas.call("GET", `/api/insights/export?scope=${fam.id}`)).status,
    404,
  );
  check(
    "a made-up scope is 404, not 500",
    (await ann.call("GET", "/api/insights?scope=not-a-family")).status,
    404,
  );

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n6. The forecast is what is coming, in this scope");
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
  await ann.call("POST", "/api/reminders", {
    title: "Ann upcoming",
    categoryId: annCat.id,
    dueAt: soon,
    amount: 2500,
  });
  const fc = (await ann.call("GET", "/api/insights")).data.forecast;
  check("one item due", fc.items.length, 1);
  check("totalling its amount", fc.total, 2500);
  check(
    "and it is not in the family forecast",
    (await ann.call("GET", `/api/insights?scope=${fam.id}`)).data.forecast.total,
    0,
  );

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n7. The CSV is a file, and it is scoped");
  const csv = await ann.call("GET", "/api/insights/export");
  check("served as CSV", csv.headers.get("content-type")?.startsWith("text/csv"), true);
  check("as an attachment", /attachment; filename=/.test(csv.headers.get("content-disposition") ?? ""), true);
  const lines = String(csv.data).trim().split("\r\n");
  check("it warns that deleted reminders are missing", /Deleting a reminder/.test(lines[0]), true);
  check("with a header row", lines[1].startsWith('"completed_on"'), true);
  check("and Ann's rows", lines.length > 2, true);
  check(
    "Ben's export has no rows of hers",
    String((await ben.call("GET", "/api/insights/export")).data).trim().split("\r\n").length,
    2,
  );

  console.log("\n   and a spreadsheet formula in it is defused");
  // lib/csv.ts imports nothing, so Node runs the real file with its types stripped —
  // no paraphrase to drift out of step. RFC 4180 quoting does not help here: Excel
  // evaluates "=1+1" on open regardless of the quotes, and both CSVs this app produces
  // carry text someone else typed. The audit dump mails every account's name to the
  // install's owner.
  const { csvCell } = await import("../lib/csv.ts");
  check("a bare formula is prefixed", csvCell("=1+1"), `"'=1+1"`);
  check("so is one that fetches a URL", csvCell('=IMPORTXML("http://x","//a")').startsWith(`"'=`), true);
  check("and the other three lead characters", [csvCell("+x"), csvCell("-x"), csvCell("@x")], [`"'+x"`, `"'-x"`, `"'@x"`]);
  // The exemption that stops the fix costing something: a negative amount has to stay a
  // number the reader can total, not text with an apostrophe in front of it.
  check("a negative amount stays a number", csvCell(-500), `"-500"`);
  check("as does a decimal one", csvCell(-500.25), `"-500.25"`);
  check("ordinary text is left exactly as it was", csvCell('Rent, flat 2 "B"'), `"Rent, flat 2 ""B"""`);

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n8. Month close is idempotent");
  const first = await tick("?rollup=1");
  check("it ran", first.rollup?.ran, true);
  const closedFirst = await prisma.monthlyRollup.count({
    where: { scopeKey: `u:${ann.id}` },
  });
  check("Ann's months were closed", closedFirst > 0, true);

  const second = await tick("?rollup=1");
  check("a second pass closes nothing new", second.rollup?.monthsClosed, 0);
  check(
    "and writes no duplicate rows",
    await prisma.monthlyRollup.count({ where: { scopeKey: `u:${ann.id}` } }),
    closedFirst,
  );

  const lastMonthKey = await prisma.monthlyRollup.findFirst({
    where: { scopeKey: `u:${ann.id}` },
    orderBy: { month: "desc" },
  });
  check("a closed month carries its total", typeof lastMonthKey?.spent, "number");
  check("and freezes the category name", typeof lastMonthKey?.categoryName, "string");

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n9. The prune refuses a month it never closed");
  // Five months back is outside CLOSE_LOOKBACK, so the close pass will never reach it.
  // That is exactly the row the prune must leave alone: no rollup means this detail is
  // the only copy that exists.
  const ancient = monthsAgo(5);
  await history(rentId, ancient, 7777);
  const beforePrune = await prisma.reminderHistory.count({
    where: { reminderId: rentId, completedOn: { lt: monthsAgo(4) } },
  });
  check("the ancient row is there", beforePrune, 1);

  const refusing = await tick("?rollup=1");
  check("the prune refused something", (refusing.rollup?.prunesRefused ?? 0) >= 1, true);
  check(
    "and the row survived",
    await prisma.reminderHistory.count({
      where: { reminderId: rentId, completedOn: { lt: monthsAgo(4) } },
    }),
    1,
  );

  console.log("\n   and prunes it once the month has been closed");
  // Standing in for a close that did happen. Its own month, its own scope.
  const ancientMonthStart = new Date(
    Date.UTC(ancient.getUTCFullYear(), ancient.getUTCMonth(), 1),
  );
  // The rollup's month key is local midnight in Asia/Kolkata, i.e. 18:30 UTC the day
  // before — matched here rather than guessed, because the prune looks it up by equality.
  const localMonthStart = new Date(ancientMonthStart.getTime() - 5.5 * 3600 * 1000);
  await prisma.monthlyRollup.create({
    data: {
      scopeKey: `u:${ann.id}`,
      month: localMonthStart,
      categoryKey: annCat.id,
      categoryName: annCat.name,
      spent: 7777,
      completions: 1,
    },
  });
  const pruning = await tick("?rollup=1");
  check("it pruned this time", (pruning.rollup?.rowsPruned ?? 0) >= 1, true);
  check(
    "the detail is gone",
    await prisma.reminderHistory.count({
      where: { reminderId: rentId, completedOn: { lt: monthsAgo(4) } },
    }),
    0,
  );
  check(
    "but the month's total remains",
    (
      await prisma.monthlyRollup.findFirst({
        where: { scopeKey: `u:${ann.id}`, month: localMonthStart },
      })
    )?.spent,
    7777,
  );

  console.log("\n   and a rollup whose scope has gone is swept");
  // scopeKey is a composite string — "u:<id>" / "f:<id>" — so there is no foreign key to
  // cascade. Deleting an account or dissolving a family left its monthly totals behind,
  // and the 24-month cap would have held them for two years: this database was carrying
  // 147 rows across 49 scopes that no longer existed.
  const ghostScope = `u:00000000-0000-4000-8000-000000000000`;
  await prisma.monthlyRollup.create({
    data: {
      scopeKey: ghostScope,
      month: localMonthStart,
      categoryKey: "none",
      categoryName: "Nothing recorded",
    },
  });
  const sweeping = await tick("?rollup=1");
  check("the sweep reported it", (sweeping.swept?.retention?.rollups ?? 0) >= 1, true);
  check(
    "the orphan is gone",
    await prisma.monthlyRollup.count({ where: { scopeKey: ghostScope } }),
    0,
  );
  check(
    "and a live scope's rollup is untouched",
    (
      await prisma.monthlyRollup.findFirst({
        where: { scopeKey: `u:${ann.id}`, month: localMonthStart },
      })
    )?.spent,
    7777,
  );

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n10. The year view counts months that have NOT been closed yet");
  // The bug this replaces: the year total read rollups plus the current month only, so any
  // month holding detail but no rollup vanished from it — while the dashboard listed the
  // very same payments. Two screens in one app disagreeing about the same money.
  //
  // Ann has rent history in this month and the two before it. Section 8 closed the older
  // ones, so testing the un-closed path means removing those rollups first.
  await prisma.monthlyRollup.deleteMany({ where: { scopeKey: `u:${ann.id}` } });
  const unclosed = (await ann.call("GET", "/api/insights/year")).data;
  check(
    "all three months are counted",
    unclosed.months.filter((m) => m.spent > 0).length,
    3,
  );
  check("and the total includes them", unclosed.total, 14000.5 + 1000 + 3000);

  console.log("\n   and closing them changes nothing");
  await tick("?rollup=1");
  const closedAgain = (await ann.call("GET", "/api/insights/year")).data;
  check("the same total, from rollups this time", closedAgain.total, unclosed.total);
  check(
    "with no month double-counted",
    closedAgain.months.filter((m) => m.spent > 0).length,
    3,
  );

  console.log("\n11. The year view reads closed months plus the live one");
  const yr = (await ann.call("GET", "/api/insights/year")).data;
  check("twelve buckets", yr.months.length, 12);
  check("the newest is this month", yr.months[11].spent, 14000.5);
  check("and the total covers the window", yr.total >= 13500.5, true);
  check("it says where detail stops", typeof yr.detailFrom, "string");

  // ──────────────────────────────────────────────────────────────────────────────
  // Last, and with amounts of 0, so nothing above has its totals moved by it.
  console.log("\n12. A month-end recurrence rolls into the next month, not past it");
  // `setUTCMonth` on its own overflows: 31 January plus a month is 31 February, which
  // normalises to 3 March. February got no reminder at all and every roll afterwards
  // sat on the 3rd, so a rent reminder dated the 31st quietly moved day. Rent and EMIs
  // are precisely the things dated on the 31st.
  const endOfMonth = async (dueAt, rule) => {
    const made = await ann.call("POST", "/api/reminders", {
      title: `Rolls from ${dueAt}`,
      categoryId: annCat.id,
      dueAt,
      amount: 0,
      recurrenceRule: rule,
    });
    const rolled = await ann.call("POST", `/api/reminders/${made.data.id}/complete`, {
      amount: 0,
    });
    return String(rolled.data.dueAt);
  };

  const feb = await endOfMonth("2026-01-31T09:00", "Monthly");
  check("31 January rolls into February", feb.slice(0, 7), "2026-02");
  check("on the last day it has", new Date(feb).getUTCDate(), 28);

  const nov = await endOfMonth("2026-08-31T09:00", "Quarterly");
  check("31 August + 3 months is 30 November, not 1 December", nov.slice(0, 10), "2026-11-30");

  const leap = await endOfMonth("2024-02-29T09:00", "Yearly");
  check("29 February rolls to the 28th, not into March", leap.slice(0, 10), "2025-02-28");

  const long = await endOfMonth("2026-01-15T09:00", "Monthly");
  check("a day that exists in every month is untouched", long.slice(0, 10), "2026-02-15");

  const daily = await endOfMonth("2026-02-28T09:00", "Daily");
  check("and Daily still just adds a day, across a month boundary", daily.slice(0, 10), "2026-03-01");

  console.log("\n13. Month-anchored recurrence lands on the 1st and the last day");
  // Unlike Monthly, these ignore the day the reminder was first given and go to the
  // edge of the month every time.
  check(
    "mid-month, Beginning of the month goes to the 1st of next month",
    (await endOfMonth("2026-03-17T09:00", "Beginning of the month")).slice(0, 10),
    "2026-04-01",
  );
  check(
    "already on the 1st, it moves on rather than staying put",
    (await endOfMonth("2026-03-01T09:00", "Beginning of the month")).slice(0, 10),
    "2026-04-01",
  );
  check(
    "mid-month, End of the month goes to the end of that month",
    (await endOfMonth("2026-03-17T09:00", "End of the month")).slice(0, 10),
    "2026-03-31",
  );
  check(
    "already on the last day, it goes to the end of the next",
    (await endOfMonth("2026-03-31T09:00", "End of the month")).slice(0, 10),
    "2026-04-30",
  );
  check(
    "and it knows February is short",
    (await endOfMonth("2026-01-31T09:00", "End of the month")).slice(0, 10),
    "2026-02-28",
  );
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
