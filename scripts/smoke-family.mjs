// Family accountability, packs and escalation smoke suite:
//   node --env-file=.env scripts/smoke-family.mjs
//
// Everything phase 2 added writes to a *shared* row, which is a different risk from the
// rest of the app: a missing clause doesn't leak someone's private list, it lets one
// household member act inside another household. So most of what follows is negative —
// who may not acknowledge, comment, nudge or read a scoreboard.
//
// The escalation section is the one that matters most, because it changes planFires() in
// lib/dispatch.ts, the single file where a bug means silence rather than an error. It
// drives the dev-only ?now= override, so each step's once-per-cycle behaviour is asserted
// against a real tick rather than reasoned about.

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

const HEAD = "fam-head@example.invalid";
const MEMBER = "fam-member@example.invalid";
const OUTSIDER = "fam-outsider@example.invalid";
const FAMILY = "Smoke Accountability";
const CONTACT = "fam-landlord@example.invalid";

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
      if (pair.startsWith("prosys_session=")) cookie = pair;
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* empty body */
    }
    return { status: res.status, data };
  };
}

const tick = (query = "") =>
  fetch(`${BASE}/api/cron/dispatch${query}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  }).then((r) => r.json());

/** `?now=` in the shape the dispatcher wants. */
const at = (iso) => `?now=${encodeURIComponent(iso)}`;

async function cleanup() {
  await prisma.family.deleteMany({ where: { name: FAMILY } });
  await prisma.externalContact.deleteMany({ where: { email: CONTACT } });
  await prisma.user.deleteMany({ where: { email: { in: [HEAD, MEMBER, OUTSIDER] } } });
}

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
    },
  });
  await s("POST", "/api/auth/login", { email, pin });
  const row = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return { call: s, id: row.id, name };
}

await assertScratchDatabase(prisma);

try {
  await cleanup();

  const head = await account(HEAD, "Smoke Head", "1111");
  const member = await account(MEMBER, "Smoke Member", "2222");
  const outsider = await account(OUTSIDER, "Smoke Outsider", "3333");
  const anon = session();

  const fam = (await head.call("POST", "/api/families", { name: FAMILY })).data;
  await member.call("POST", "/api/families/join", { joinCode: fam.joinCode });

  const cat = (await head.call("GET", `/api/categories?scope=${fam.id}`)).data[0];
  const shared = (
    await head.call("POST", "/api/reminders", {
      title: "Shared electricity",
      categoryId: cat.id,
      dueAt: "2026-12-01",
      amount: 2000,
      familyId: fam.id,
      audience: "assignee",
      assignedToId: member.id,
    })
  ).data;
  const personal = (
    await head.call("POST", "/api/reminders", {
      title: "Head's own thing",
      categoryId: (await head.call("GET", "/api/categories?scope=mine")).data[0].id,
      dueAt: "2026-12-02",
    })
  ).data;

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n1. Anonymous callers get nothing");
  for (const [method, path] of [
    ["POST", `/api/reminders/${shared.id}/acknowledge`],
    ["GET", `/api/reminders/${shared.id}/comments`],
    ["POST", `/api/reminders/${shared.id}/nudge`],
    ["GET", `/api/families/${fam.id}/activity`],
    ["GET", `/api/families/${fam.id}/scoreboard`],
    ["GET", "/api/templates"],
    ["POST", "/api/templates/import"],
    ["GET", "/api/contacts"],
  ]) {
    // Body only on the verbs that accept one — fetch throws on a GET with a body.
    check(
      `${method} ${path}`,
      (await anon(method, path, method === "GET" ? undefined : {})).status,
      401,
    );
  }

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n2. Acknowledgement is for recipients only");
  check(
    "the outsider cannot even see it",
    (await outsider.call("POST", `/api/reminders/${shared.id}/acknowledge`)).status,
    404,
  );
  // Addressed to the assignee, so the head — who created it — is not a recipient.
  check(
    "the creator is not a recipient of an assignee-addressed reminder",
    (await head.call("POST", `/api/reminders/${shared.id}/acknowledge`)).status,
    403,
  );
  check(
    "a personal reminder has nobody to tell",
    (await head.call("POST", `/api/reminders/${personal.id}/acknowledge`)).status,
    400,
  );

  const ack = await member.call("POST", `/api/reminders/${shared.id}/acknowledge`);
  check("the assignee can", ack.status, 200);
  check("and is recorded as the claimant", ack.data?.acknowledgedById, member.id);

  const again = await member.call("POST", `/api/reminders/${shared.id}/acknowledge`);
  check("a second tap changes nothing", again.data?.alreadyAcknowledged, true);

  console.log("\n   only the claimant can hand it back");
  check(
    "the head cannot",
    (await head.call("DELETE", `/api/reminders/${shared.id}/acknowledge`)).status,
    403,
  );
  check(
    "the claimant can",
    (await member.call("DELETE", `/api/reminders/${shared.id}/acknowledge`)).status,
    200,
  );

  console.log("\n   and completing clears it for the next cycle");
  await member.call("POST", `/api/reminders/${shared.id}/acknowledge`);
  await member.call("POST", `/api/reminders/${shared.id}/complete`, {});
  const afterComplete = await prisma.reminder.findUnique({
    where: { id: shared.id },
    select: { acknowledgedAt: true, acknowledgedById: true },
  });
  check("acknowledgedAt is cleared", afterComplete.acknowledgedAt, null);
  check("and so is the claimant", afterComplete.acknowledgedById, null);

  console.log("\n   completing stamps the cycle it settled");
  const hist = await prisma.reminderHistory.findFirst({
    where: { reminderId: shared.id },
    select: { cycleDueAt: true },
  });
  check("cycleDueAt was recorded", hist?.cycleDueAt !== null, true);

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n3. Comments follow the reminder's own visibility");
  check(
    "the outsider gets 404 reading",
    (await outsider.call("GET", `/api/reminders/${shared.id}/comments`)).status,
    404,
  );
  check(
    "and 404 writing",
    (await outsider.call("POST", `/api/reminders/${shared.id}/comments`, { body: "hi" }))
      .status,
    404,
  );
  check(
    "an empty comment is a 400",
    (await member.call("POST", `/api/reminders/${shared.id}/comments`, { body: "   " }))
      .status,
    400,
  );

  const said = await member.call("POST", `/api/reminders/${shared.id}/comments`, {
    body: "Paying this on Monday",
  });
  check("a member can comment", said.status, 201);
  const list = (await head.call("GET", `/api/reminders/${shared.id}/comments`)).data;
  check("the head sees it", list.length, 1);
  check("attributed", list[0].author, member.name);
  check("and knows it isn't theirs", list[0].self, false);

  console.log("\n   the head can delete a member's comment; a member cannot delete another's");
  const headSaid = await head.call("POST", `/api/reminders/${shared.id}/comments`, {
    body: "Thanks",
  });
  check(
    "the member cannot delete the head's",
    (await member.call("DELETE", `/api/reminders/${shared.id}/comments/${headSaid.data.id}`))
      .status,
    403,
  );
  check(
    "the head can delete the member's",
    (await head.call("DELETE", `/api/reminders/${shared.id}/comments/${said.data.id}`)).status,
    200,
  );
  // A comment id from a thread you can see must not unlock one you can't.
  check(
    "a comment id from another reminder is 404",
    (await head.call("DELETE", `/api/reminders/${personal.id}/comments/${headSaid.data.id}`))
      .status,
    404,
  );

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n4. Nudges are off until the family turns them on");
  const overdue = (
    await head.call("POST", "/api/reminders", {
      title: "Overdue shared thing",
      categoryId: cat.id,
      dueAt: "2020-01-01",
      familyId: fam.id,
      audience: "assignee",
      assignedToId: member.id,
    })
  ).data;
  check(
    "refused while allowNudges is off",
    (await head.call("POST", `/api/reminders/${overdue.id}/nudge`)).status,
    403,
  );
  check(
    "a member cannot switch it on",
    (await member.call("PATCH", `/api/families/${fam.id}`, { allowNudges: true })).status,
    403,
  );
  check(
    "the head can",
    (await head.call("PATCH", `/api/families/${fam.id}`, { allowNudges: true })).status,
    200,
  );
  check("now it goes", (await head.call("POST", `/api/reminders/${overdue.id}/nudge`)).status, 201);
  check(
    "but not twice",
    (await head.call("POST", `/api/reminders/${overdue.id}/nudge`)).status,
    429,
  );

  const notOverdue = (
    await head.call("POST", "/api/reminders", {
      title: "Not late yet",
      categoryId: cat.id,
      dueAt: "2030-01-01",
      familyId: fam.id,
      audience: "assignee",
      assignedToId: member.id,
    })
  ).data;
  check(
    "and never before it's late",
    (await head.call("POST", `/api/reminders/${notOverdue.id}/nudge`)).status,
    400,
  );

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n5. The scoreboard hides what the family hasn't switched on");
  const board = (await member.call("GET", `/api/families/${fam.id}/scoreboard`)).data;
  check("not ranked by default", board.ranked, false);
  check("no streaks by default", board.streaks, false);
  check("streak fields are absent", board.members[0].streakWeeks, undefined);
  check("but everyone sees their own numbers", typeof board.members[0].completed, "number");
  check(
    "an outsider cannot read it",
    (await outsider.call("GET", `/api/families/${fam.id}/scoreboard`)).status,
    404,
  );
  check(
    "nor the activity feed",
    (await outsider.call("GET", `/api/families/${fam.id}/activity`)).status,
    404,
  );

  await head.call("PATCH", `/api/families/${fam.id}`, { showStreaks: true });
  const withStreaks = (await member.call("GET", `/api/families/${fam.id}/scoreboard`)).data;
  check("switching streaks on reveals them", typeof withStreaks.members[0].streakWeeks, "number");

  console.log("\n   the feed carries completions and comments together");
  const feed = (await member.call("GET", `/api/families/${fam.id}/activity`)).data;
  check("it has entries", feed.length > 0, true);
  check("of both kinds", new Set(feed.map((e) => e.kind)).size, 2);

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n6. Packs import once, whatever you press");
  const packs = (await head.call("GET", "/api/templates?scope=mine")).data;
  check("four packs are offered", packs.packs.length, 4);
  const pack = packs.packs.find((p) => p.id === "in-household");
  check("with resolved dates", typeof pack.items[0].dueAt, "string");
  check("and nothing imported yet", pack.items.every((i) => !i.alreadyImported), true);

  const keys = pack.items.slice(0, 3).map((i) => i.key);
  const first = await head.call("POST", "/api/templates/import", {
    pack: "in-household",
    scope: "mine",
    keys,
  });
  check("three created", first.data?.created, 3);
  const second = await head.call("POST", "/api/templates/import", {
    pack: "in-household",
    scope: "mine",
    keys,
  });
  check("a second import creates nothing", second.data?.created, 0);
  check("and says they were already there", second.data?.skipped, 3);
  check(
    "an unknown pack is a 400",
    (await head.call("POST", "/api/templates/import", { pack: "nope", scope: "mine" })).status,
    400,
  );
  check(
    "importing into someone else's family is 404",
    (await outsider.call("POST", "/api/templates/import", {
      pack: "in-household",
      scope: fam.id,
      keys,
    })).status,
    404,
  );

  console.log("\n   a family import lands on the shared list, addressed to everyone");
  await head.call("POST", "/api/templates/import", {
    pack: "homeowner",
    scope: fam.id,
    keys: [packs.packs.find((p) => p.id === "homeowner").items[0].key],
  });
  const imported = await prisma.reminder.findFirst({
    where: { familyId: fam.id, templateKey: { not: null } },
    select: { audience: true, familyId: true },
  });
  check("on the family list", imported?.familyId, fam.id);
  check("addressed to the family", imported?.audience, "family");

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n7. Outside contacts are not written to until they agree");
  const added = await head.call("POST", "/api/contacts", { email: CONTACT, label: "Landlord" });
  check("added", added.status, 201);
  check("in the 'new' state", added.data?.state, "new");
  check(
    "a duplicate is a 409",
    (await head.call("POST", "/api/contacts", { email: CONTACT })).status,
    409,
  );
  check(
    "rubbish is a 400",
    (await head.call("POST", "/api/contacts", { email: "not-an-email" })).status,
    400,
  );
  check(
    "and they are private to the account",
    (await member.call("GET", "/api/contacts")).data.length,
    0,
  );
  check(
    "so another account cannot delete one",
    (await member.call("DELETE", "/api/contacts", { id: added.data.id })).status,
    404,
  );

  console.log("\n   a declined address can never be added again");
  await prisma.externalContact.update({
    where: { id: added.data.id },
    data: { blockedAt: new Date(), tokenHash: null },
  });
  check(
    "the owner cannot remove the record",
    (await head.call("DELETE", "/api/contacts", { id: added.data.id })).status,
    400,
  );
  check(
    "and nobody else can re-add the address",
    (await member.call("POST", "/api/contacts", { email: CONTACT })).status,
    400,
  );
  await prisma.externalContact.update({
    where: { id: added.data.id },
    data: { blockedAt: null, confirmedAt: new Date() },
  });

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n8. An escalation chain is validated before it is stored");
  const base = {
    title: "Escalating bill",
    categoryId: cat.id,
    dueAt: "2027-03-10T08:00",
    familyId: fam.id,
    audience: "assignee",
    assignedToId: member.id,
  };
  check(
    "a step too soon is refused",
    (await head.call("POST", "/api/reminders", {
      ...base,
      escalation: [{ afterMins: 1, notify: "head" }],
    })).status,
    400,
  );
  check(
    "an unknown target is refused",
    (await head.call("POST", "/api/reminders", {
      ...base,
      escalation: [{ afterMins: 60, notify: "the-neighbours" }],
    })).status,
    400,
  );
  check(
    "an external step with no contact is refused",
    (await head.call("POST", "/api/reminders", {
      ...base,
      escalation: [{ afterMins: 60, notify: "external" }],
    })).status,
    400,
  );
  check(
    "someone else's contact is refused",
    (await member.call("POST", "/api/reminders", {
      ...base,
      escalation: [{ afterMins: 60, notify: "external", contactId: added.data.id }],
    })).status,
    400,
  );

  const chain = (
    await head.call("POST", "/api/reminders", {
      ...base,
      escalation: [
        { afterMins: 120, notify: "head" },
        { afterMins: 60, notify: "assignee" },
      ],
    })
  ).data;
  const stored = await prisma.reminder.findUnique({
    where: { id: chain.id },
    select: { escalation: true },
  });
  check("stored in time order", stored.escalation.map((s) => s.afterMins), [60, 120]);

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("\n9. Each step fires once per cycle, and acknowledgement stops the chain");
  const due = new Date("2027-03-10T08:00:00+05:30");
  const plus = (mins) => new Date(due.getTime() + mins * 60_000).toISOString();

  // Before the first step's time: nothing escalates.
  const early = await tick(at(plus(30)));
  check("nothing at 30 minutes", early.fired?.escalation ?? 0, 0);

  const firstStep = await tick(at(plus(65)));
  check("the 60-minute step fires", firstStep.fired?.escalation, 1);
  const repeat = await tick(at(plus(70)));
  check("and not again on the next tick", repeat.fired?.escalation ?? 0, 0);

  const secondStep = await tick(at(plus(125)));
  check("the 120-minute step fires", secondStep.fired?.escalation, 1);

  const rows = await prisma.reminderDispatch.count({
    where: { reminderId: chain.id, kind: "escalation" },
  });
  check("two escalation rows in total", rows, 2);

  console.log("\n   acknowledgement stops it");
  const ackChain = (
    await head.call("POST", "/api/reminders", {
      ...base,
      title: "Acknowledged chain",
      escalation: [{ afterMins: 60, notify: "head" }],
    })
  ).data;
  await member.call("POST", `/api/reminders/${ackChain.id}/acknowledge`);
  const silenced = await tick(at(plus(200)));
  check(
    "no escalation for the acknowledged one",
    await prisma.reminderDispatch.count({
      where: { reminderId: ackChain.id, kind: "escalation" },
    }),
    0,
  );
  check("dispatch itself still ran", silenced.ran, true);

  console.log("\n   and the nag limit caps it");
  const late = await tick(at(plus(20 * 24 * 60)));
  check(
    "nothing new 20 days after due",
    await prisma.reminderDispatch.count({
      where: { reminderId: chain.id, kind: "escalation" },
    }),
    2,
  );
  check("the run completed", late.ran, true);

  console.log("\n   a reminder with no chain is untouched by any of it");
  check(
    "no escalation rows for the plain shared reminder",
    await prisma.reminderDispatch.count({
      where: { reminderId: shared.id, kind: "escalation" },
    }),
    0,
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
