// Security smoke suite:  node --env-file=.env scripts/smoke-security.mjs
//
// Asserts the properties that make a multi-user app with *private* reminders safe.
// These are exactly the things a refactor breaks quietly: a `where` clause that
// loses its userId still returns data and still looks fine on screen.
//
// Needs the dev server running (npm run dev). Seeds two accounts, checks that
// neither can reach the other's data, and deletes them again.

import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const BASE = process.env.BASE_URL || "http://localhost:3000";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL ?? "")
    ? undefined
    : { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const ALICE = "smoke-alice@example.invalid";
const BOB = "smoke-bob@example.invalid";

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

/** Minimal cookie-jar fetch, so each account keeps its own session. */
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
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
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

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { in: [ALICE, BOB] } } });
}

try {
  await cleanup(); // in case a previous run died half-way

  const hadUsers = (await prisma.user.count()) > 0;
  const anon = session();
  const alice = session();
  const bob = session();

  console.log("\n1. Unauthenticated requests are refused");
  check("GET /api/reminders", (await anon("GET", "/api/reminders")).status, 401);
  check("GET /api/settings", (await anon("GET", "/api/settings")).status, 401);
  check("GET /api/users", (await anon("GET", "/api/users")).status, 401);
  check("GET /api/sessions", (await anon("GET", "/api/sessions")).status, 401);
  check("POST /api/push/subscribe", (await anon("POST", "/api/push/subscribe", {})).status, 401);
  check(
    "GET /api/cron/dispatch without secret",
    (await anon("GET", "/api/cron/dispatch")).status,
    401,
  );
  check(
    "GET /api/auth/status is public",
    (await anon("GET", "/api/auth/status")).status,
    200,
  );

  console.log("\n2. Signup requires approval");
  // On a database that already has accounts, both of these land as pending.
  // On an empty one the first would be auto-approved as admin, so the suite
  // creates Alice first and promotes her directly if that happened.
  const regA = await alice("POST", "/api/auth/register", {
    name: "Smoke Alice",
    email: ALICE,
    pin: "1111",
  });
  const regB = await bob("POST", "/api/auth/register", {
    name: "Smoke Bob",
    email: BOB,
    pin: "2222",
  });
  check("Bob is pending", regB.data?.status, "pending");
  check(
    "pending account cannot sign in",
    (await bob("POST", "/api/auth/login", { email: BOB, pin: "2222" })).status,
    403,
  );

  // Approve both directly in the database — this suite is testing the API's
  // authorisation, not the admin UI.
  await prisma.user.updateMany({
    where: { email: { in: [ALICE, BOB] } },
    data: { status: "active", approvedAt: new Date() },
  });
  if (regA.data?.status !== "active") {
    // Alice was not the first account, so she is a plain member.
    await prisma.user.update({ where: { email: ALICE }, data: { role: "member" } });
  }
  await prisma.user.update({ where: { email: BOB }, data: { role: "member" } });

  check(
    "approved account can sign in",
    (await alice("POST", "/api/auth/login", { email: ALICE, pin: "1111" })).status,
    200,
  );
  await bob("POST", "/api/auth/login", { email: BOB, pin: "2222" });

  console.log("\n3. Wrong credentials are indistinguishable");
  const wrongPin = await anon("POST", "/api/auth/login", { email: ALICE, pin: "9999" });
  const noSuchUser = await anon("POST", "/api/auth/login", {
    email: "nobody@example.invalid",
    pin: "9999",
  });
  check("wrong PIN is 401", wrongPin.status, 401);
  check("unknown email is 401", noSuchUser.status, 401);
  check("same message for both", wrongPin.data?.message, noSuchUser.data?.message);

  console.log("\n4. Alice's data is invisible to Bob");
  const aliceCat = (await alice("GET", "/api/categories")).data?.[0];
  const aliceRem = (
    await alice("POST", "/api/reminders", {
      title: "Alice private",
      categoryId: aliceCat.id,
      dueAt: "2026-12-01",
    })
  ).data;

  const bobCats = (await bob("GET", "/api/categories")).data ?? [];
  check("Bob sees no reminders of Alice's", (await bob("GET", "/api/reminders")).data?.length, 0);
  check(
    "Bob's categories are his own",
    bobCats.some((c) => c.id === aliceCat.id),
    false,
  );
  check("Bob cannot read it", (await bob("GET", `/api/reminders/${aliceRem.id}`)).status, 404);
  check(
    "Bob cannot edit it",
    (await bob("PATCH", `/api/reminders/${aliceRem.id}`, { title: "x" })).status,
    404,
  );
  check(
    "Bob cannot delete it",
    (await bob("DELETE", `/api/reminders/${aliceRem.id}`)).status,
    404,
  );
  check(
    "Bob cannot snooze it",
    (await bob("POST", `/api/reminders/${aliceRem.id}/snooze`, { minutes: 60 })).status,
    404,
  );
  check(
    "Bob cannot complete it",
    (await bob("POST", `/api/reminders/${aliceRem.id}/complete`, {})).status,
    404,
  );
  check(
    "Bob cannot use Alice's category",
    (await bob("POST", "/api/reminders", {
      title: "cross",
      categoryId: aliceCat.id,
      dueAt: "2026-12-01",
    })).status,
    404,
  );
  check(
    "Bob cannot rename Alice's category",
    (await bob("PATCH", `/api/categories/${aliceCat.id}`, { name: "hijacked" })).status,
    404,
  );
  check(
    "reminder still belongs to Alice",
    (await prisma.reminder.findUnique({ where: { id: aliceRem.id } }))?.title,
    "Alice private",
  );

  console.log("\n5. Ownership cannot be set from the request body");
  const bobId = (await prisma.user.findUnique({ where: { email: BOB } })).id;
  const bobCat = bobCats[0];
  const planted = (
    await alice("POST", "/api/reminders", {
      title: "planted",
      categoryId: aliceCat.id,
      dueAt: "2026-12-02",
      userId: bobId,
    })
  ).data;
  const plantedRow = await prisma.reminder.findUnique({ where: { id: planted.id } });
  const aliceId = (await prisma.user.findUnique({ where: { email: ALICE } })).id;
  check("userId in the body is ignored", plantedRow.userId, aliceId);
  check("Bob still sees nothing", (await bob("GET", "/api/reminders")).data?.length, 0);
  void bobCat;

  console.log("\n6. Members cannot use the admin API");
  check("GET /api/users", (await bob("GET", "/api/users")).status, 403);
  check(
    "PATCH /api/users/:id",
    (await bob("PATCH", `/api/users/${aliceId}`, { status: "rejected" })).status,
    403,
  );
  check("DELETE /api/users/:id", (await bob("DELETE", `/api/users/${aliceId}`)).status, 403);

  console.log("\n7. Sessions and devices are per account");
  const aliceSessions = (await alice("GET", "/api/sessions")).data ?? [];
  const bobSessions = (await bob("GET", "/api/sessions")).data ?? [];
  const aliceIds = new Set(aliceSessions.map((s) => s.id));
  const bobIds = new Set(bobSessions.map((s) => s.id));
  // Counts aren't asserted: registering the very first account on an empty
  // database signs it in, so Alice legitimately holds two sessions on a fresh
  // run and one otherwise. What matters is that the two lists never overlap.
  check("Alice has at least one login", aliceSessions.length > 0, true);
  check("Bob has at least one login", bobSessions.length > 0, true);
  check(
    "no session appears in both lists",
    [...aliceIds].some((id) => bobIds.has(id)),
    false,
  );
  check(
    "exactly one of Alice's is marked current",
    aliceSessions.filter((s) => s.current).length,
    1,
  );
  check(
    "Bob cannot revoke Alice's login",
    (await bob("DELETE", `/api/sessions?id=${aliceSessions[0].id}`)).data?.revoked,
    0,
  );
  check(
    "Alice's login survives",
    (await alice("GET", "/api/reminders")).status,
    200,
  );

  console.log("\n8. Rejecting an account kills its live sessions");
  await prisma.user.update({ where: { id: bobId }, data: { status: "rejected" } });
  check("Bob's session is dropped", (await bob("GET", "/api/reminders")).status, 401);

  if (hadUsers) {
    console.log(
      "\nnote: ran against a database that already had accounts; only the two smoke accounts were touched.",
    );
  }
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
