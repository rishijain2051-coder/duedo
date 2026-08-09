// Voice capture smoke suite:  node --env-file=.env scripts/smoke-dictation.mjs
//
// Two halves:
//
//   1. The parser, under Node. lib/dictation.ts imports nothing, so Node runs the real
//      file with its types stripped rather than a paraphrase. Every rule in it is a
//      judgement about ambiguous English, and the only alternative way to exercise one
//      is to talk at a phone and see what happens — which tests one wording, once.
//   2. The endpoint, against the running dev server, because the token is the whole
//      credential and "it refuses the wrong one" is not something to take on trust.
//
// Needs the dev server running (npm run dev). Seeds one account and deletes it again.

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

const EMAIL = "dictation@example.invalid";

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

async function cleanup() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) return;
  const owned = await prisma.reminder.findMany({ where: { userId: user.id }, select: { id: true } });
  await prisma.notification.deleteMany({ where: { reminderId: { in: owned.map((r) => r.id) } } });
  await prisma.user.delete({ where: { id: user.id } });
}

await assertScratchDatabase(prisma);
await cleanup();

const { parseDictation } = await import("../lib/dictation.ts");

// A fixed Monday so weekday and month arithmetic is decidable rather than
// whatever-day-the-suite-runs.
const NOW = new Date("2026-08-10T06:00:00Z"); // Monday 10 August 2026, 11:30 IST
const TZ = "Asia/Kolkata";

const say = (text, categories = []) =>
  parseDictation({ text, now: NOW, timeZone: TZ, defaultTime: "05:30", categories });

try {
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n1. The title is whatever no rule claimed");
  check("lead-in is stripped", say("remind me to pay the electricity bill").title, "Pay the electricity bill");
  check("so is a longer one", say("hey add a new reminder to call the plumber").title, "Call the plumber");
  check("a bare sentence is left alone", say("water the plants").title, "Water the plants");
  check(
    "and the words a date used are lifted out of the middle",
    say("pay rent on the 15th").title,
    "Pay rent",
  );
  check(
    "two dangling words are both trimmed, not one",
    say("pay rent at the end of every month").title,
    "Pay rent",
  );
  check(
    "a month name is capitalised when read back",
    say("renew passport 15 September").understood[0],
    "15 September 2026",
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n2. Dates");
  check("no date said means today", say("call mum").dueAt, "2026-08-10");
  check("and it says it assumed", say("call mum").dateAssumed, true);
  check("today", say("call mum today").dueAt, "2026-08-10");
  check("tomorrow", say("call mum tomorrow").dueAt, "2026-08-11");
  check("day after tomorrow", say("call mum day after tomorrow").dueAt, "2026-08-12");
  check("in 3 days", say("call mum in 3 days").dueAt, "2026-08-13");
  check("in two weeks", say("call mum in two weeks").dueAt, "2026-08-24");
  check("in a month", say("call mum in a month").dueAt, "2026-09-10");
  check("on the 15th, still ahead this month", say("pay rent on the 15th").dueAt, "2026-08-15");
  check("on the 3rd, already gone, so next month", say("pay rent on the 3rd").dueAt, "2026-09-03");
  check("end of this month", say("pay rent at the end of the month").dueAt, "2026-08-31");
  check("1st of next month", say("pay rent on the 1st of next month").dueAt, "2026-09-01");
  check("a weekday goes forward", say("call mum on friday").dueAt, "2026-08-14");
  check(
    "and naming today's weekday means next week, not this morning",
    say("call mum on monday").dueAt,
    "2026-08-17",
  );
  check("day then month", say("renew passport 15 September").dueAt, "2026-09-15");
  check("month then day", say("renew passport September 15").dueAt, "2026-09-15");
  check("with an ordinal and an of", say("renew passport 15th of September").dueAt, "2026-09-15");
  check(
    "a month already gone means next year",
    say("renew passport 15 March").dueAt,
    "2027-03-15",
  );
  check("slashes are day first", say("renew passport 15/9").dueAt, "2026-09-15");
  check("with a year", say("renew passport 15/9/2027").dueAt, "2027-09-15");
  check(
    "and a day that month is too short for is clamped",
    say("do the thing 31 September").dueAt,
    "2026-09-30",
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n3. Times");
  check("at 6pm", say("call mum at 6pm").dueAt, "2026-08-10T18:00");
  check("6:30 pm", say("call mum at 6:30 pm").dueAt, "2026-08-10T18:30");
  check("12am is midnight", say("call mum at 12am").dueAt, "2026-08-10T00:00");
  check("12pm is noon", say("call mum at 12pm").dueAt, "2026-08-10T12:00");
  check("24-hour", say("call mum at 18:45").dueAt, "2026-08-10T18:45");
  check("noon", say("call mum at noon").dueAt, "2026-08-10T12:00");
  check("midnight", say("call mum at midnight").dueAt, "2026-08-10T00:00");
  check("evening", say("call mum in the evening").dueAt, "2026-08-10T18:00");
  check("date and time together", say("pay rent on the 15th at 9am").dueAt, "2026-08-15T09:00");
  check("no time said leaves the date bare", say("pay rent on the 15th").dueAt, "2026-08-15");

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n4. Amounts");
  check("rupees after", say("pay rent 18000 rupees").amount, 18000);
  check("rs before", say("pay rent rs 18000").amount, 18000);
  check("a symbol", say("pay rent ₹18,000").amount, 18000);
  check("commas and paise", say("pay rent 18,500.50 rupees").amount, 18500.5);
  check("and the amount leaves the title", say("pay rent 18000 rupees").title, "Pay rent");
  check("no amount said means none", say("pay rent").amount, undefined);
  check(
    "a bare number is not an amount — it might be part of the title",
    say("call flat 2 about the leak").amount,
    undefined,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n5. Recurrence, only when a schedule was actually asked for");
  check("every month", say("pay rent every month").recurrenceRule, "Monthly");
  check("monthly", say("pay rent monthly").recurrenceRule, "Monthly");
  check("every day", say("take pills every day").recurrenceRule, "Daily");
  check("weekly", say("water plants weekly").recurrenceRule, "Weekly");
  check("quarterly", say("pay advance tax quarterly").recurrenceRule, "Quarterly");
  check("every six months", say("service the car every 6 months").recurrenceRule, "Half-Yearly");
  check("yearly", say("renew insurance yearly").recurrenceRule, "Yearly");
  check(
    "end of every month is a schedule",
    say("pay rent at the end of every month").recurrenceRule,
    "End of the month",
  );
  check(
    "start of every month too",
    say("pay maid on the 1st of every month").recurrenceRule,
    "Beginning of the month",
  );
  check(
    "but end of THE month is a date, not a schedule",
    say("pay rent at the end of the month").recurrenceRule,
    undefined,
  );
  check(
    "and that one still gets the date",
    say("pay rent at the end of the month").dueAt,
    "2026-08-31",
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n6. Priority, category and notes");
  check("urgent", say("pay the fine urgent").priority, "high");
  check("high priority", say("pay the fine high priority").priority, "high");
  check("low priority", say("sort the shelf low priority").priority, "low");
  check("nothing said means nothing set", say("pay the fine").priority, undefined);

  const cats = [
    { id: "cat-bills", name: "Utility Bills" },
    { id: "cat-vehicle", name: "Vehicle" },
  ];
  check("named as a category", say("pay the bill under Utility Bills", cats).categoryId, "cat-bills");
  check("said the other way round", say("pay the bill Vehicle category", cats).categoryId, "cat-vehicle");
  check(
    "a bare mention is NOT a category — it is part of what you said",
    say("pay the vehicle insurance", cats).categoryId,
    undefined,
  );
  check(
    "and that wording stays in the title",
    say("pay the vehicle insurance", cats).title,
    "Pay the vehicle insurance",
  );
  check("notes", say("pay rent note the meter reading is 4321").description, "The meter reading is 4321");

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n7. Everything at once");
  const full = say("remind me to pay the rent on the 15th at 9am 18000 rupees every month high priority", cats);
  check("title", full.title, "Pay the rent");
  check("due", full.dueAt, "2026-08-15T09:00");
  check("amount", full.amount, 18000);
  check("recurrence", full.recurrenceRule, "Monthly");
  check("priority", full.priority, "high");
  check("and it can say what it heard", full.understood[0], "the 15 at 09:00");

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n8. The endpoint refuses anything but a live token");
  const post = (body, headers = {}) =>
    fetch(`${BASE}/api/ingest/reminder`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

  check("no token", (await post({ text: "hello" })).status, 401);
  check(
    "a wrong token",
    (await post({ text: "hello" }, { Authorization: "Bearer prosys_not-a-real-token-value" })).status,
    401,
  );
  check("GET is refused with an explanation", (await fetch(`${BASE}/api/ingest/reminder`)).status, 405);

  // A real account, activated, with a token minted the way the settings route does.
  const user = await prisma.user.create({
    data: {
      email: EMAIL,
      name: "Dictation",
      status: "active",
      emailVerifiedAt: new Date(),
      timezone: TZ,
    },
    select: { id: true },
  });
  const { createHmac, randomBytes } = await import("node:crypto");
  const plain = "prosys_" + randomBytes(32).toString("base64url");
  const hash = createHmac("sha256", process.env.AUTH_SECRET || "dev-insecure-secret-change-me")
    .update(plain)
    .digest("hex");
  await prisma.user.update({
    where: { id: user.id },
    data: { apiTokenHash: hash, apiTokenCreatedAt: new Date() },
  });
  const auth = { Authorization: `Bearer ${plain}` };

  console.log("\n9. And adds a reminder from one spoken sentence");
  const added = await post({ text: "remind me to pay the water bill tomorrow at 7pm 610 rupees" }, auth);
  check("created", added.status, 201);
  check("title", added.data?.title, "Pay the water bill");
  check("it reads something back", typeof added.data?.spoken, "string");

  const saved = await prisma.reminder.findFirst({
    where: { userId: user.id },
    include: { category: true },
  });
  check("it is on the account the token belongs to", Boolean(saved), true);
  check("with no category named, it lands in Others", saved?.category?.name, "Others");
  check("and the amount came through", saved?.amount, 610);

  check("empty dictation is refused", (await post({ text: "   " }, auth)).status, 400);
  check(
    "a date with nothing to be reminded about is refused",
    (await post({ text: "tomorrow at 7pm" }, auth)).status,
    400,
  );

  console.log("\n10. The generated shortcut file");
  // Same builder the Add shortcut button and the CLI script both call. What is worth
  // asserting is the linkage, because a wrong UUID posts an empty body and the failure
  // only shows up on a phone.
  const { buildShortcut, KEY_PLACEHOLDER } = await import("../lib/shortcut.ts");
  const file = buildShortcut({
    key: "prosys_sample",
    baseUrl: "https://example.test/",
    uuid: "AAAA-BBBB",
  });
  check(
    "four actions, in order",
    [...file.matchAll(/is\.workflow\.actions\.([a-z]+)/g)].map((m) => m[1]),
    ["dictatetext", "downloadurl", "getvalueforkey", "speaktext"],
  );
  check("the key is embedded as a bearer header", /Bearer prosys_sample/.test(file), true);
  check(
    "the body reads the dictate action's output",
    /<key>OutputUUID<\/key><string>AAAA-BBBB<\/string>/.test(file),
    true,
  );
  check(
    "and the variable placeholder occupies the whole field",
    /<string>￼<\/string>[\s\S]*?\{0, 1\}/.test(file),
    true,
  );
  check("a trailing slash on the url is not doubled", /example\.test\/api\/ingest/.test(file), true);
  check(
    "with no key it carries the placeholder instead",
    buildShortcut({ key: KEY_PLACEHOLDER, baseUrl: "https://example.test", uuid: "X" }).includes(
      "Bearer REPLACE_WITH_YOUR_KEY",
    ),
    true,
  );

  console.log("\n11. A revoked token stops working");
  await prisma.user.update({ where: { id: user.id }, data: { apiTokenHash: null } });
  check("revoked", (await post({ text: "should not land" }, auth)).status, 401);
  check(
    "and nothing was added by it",
    await prisma.reminder.count({ where: { userId: user.id } }),
    1,
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
