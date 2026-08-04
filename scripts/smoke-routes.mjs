// Route contract smoke suite:  node --env-file=.env scripts/smoke-routes.mjs
//
// The other two suites test behaviour: who can see what (smoke-security) and what
// the engine sends (smoke-dispatch). This one tests the *edges* of every route —
// the things nobody exercises by hand and which therefore rot silently:
//
//   * every protected route refuses an anonymous caller with 401, not 200 and not 500
//   * every method a route does NOT declare answers 405
//   * a malformed or empty JSON body is a 400, never a 500
//   * a nonexistent or someone else's id is 404, never a leak and never a crash
//   * every query parameter can be given rubbish without the handler falling over
//   * a page URL that needs a session still serves its shell rather than erroring
//
// A 500 is the interesting failure here. It means a bad request reached code that
// assumed a good one, and in production that is an unhandled exception in a log
// rather than a message the user can act on.
//
// Needs the dev server running (npm run dev). Seeds three accounts and one family,
// then deletes them again.

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

const ADMIN = "route-admin@example.invalid";
const MEMBER = "route-member@example.invalid";
const OUTSIDER = "route-outsider@example.invalid";
const FAMILY_NAME = "Route Smoke Family";

// A syntactically plausible id that will never exist.
const GHOST = "00000000-0000-4000-8000-000000000000";

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

/** Cookie-jar fetch, one per account. `raw` sends the body bytes untouched. */
function session() {
  let cookie = "";
  return async function call(method, path, body, raw = false) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
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
      /* empty or non-JSON body */
    }
    return { status: res.status, data };
  };
}

async function cleanup() {
  await prisma.family.deleteMany({ where: { name: { in: [FAMILY_NAME, "Route Second"] } } });
  await prisma.user.deleteMany({
    where: { email: { in: [ADMIN, MEMBER, OUTSIDER] } },
  });
}

await assertScratchDatabase(prisma);

try {
  await cleanup();

  const anon = session();
  const admin = session();
  const member = session();
  const outsider = session();

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n1. Public surface answers without a session");

  const health = await anon("GET", "/api/health");
  check("GET /api/health", health.status, 200);
  check("GET /api/health status field", health.data?.status, "ok");
  check("GET /api/version", (await anon("GET", "/api/version")).status, 200);
  check(
    "GET /api/version has a buildId",
    typeof (await anon("GET", "/api/version")).data?.buildId,
    "string",
  );
  check("GET /api/auth/status", (await anon("GET", "/api/auth/status")).status, 200);
  check(
    "POST /api/auth/logout is harmless without a session",
    (await anon("POST", "/api/auth/logout")).status,
    200,
  );
  check(
    "POST /api/webauthn/auth-options is pre-login",
    (await anon("POST", "/api/webauthn/auth-options")).status,
    200,
  );
  check(
    "auth-options offers no credential list",
    (await anon("POST", "/api/webauthn/auth-options")).data?.allowCredentials,
    undefined,
  );
  check(
    "GET /api/cron/dispatch without the secret",
    (await anon("GET", "/api/cron/dispatch")).status,
    401,
  );
  check(
    "POST /api/cron/dispatch with the wrong secret",
    (
      await fetch(`${BASE}/api/cron/dispatch`, {
        method: "POST",
        headers: { Authorization: "Bearer not-the-secret" },
      })
    ).status,
    401,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n2. Every protected route refuses an anonymous caller");

  const PROTECTED = [
    ["GET", "/api/auth/me"],
    ["GET", "/api/bootstrap"],
    ["GET", "/api/badge"],
    ["GET", "/api/users"],
    ["PATCH", `/api/users/${GHOST}`, { status: "active" }],
    ["DELETE", `/api/users/${GHOST}`],
    ["GET", "/api/admin/overview"],
    ["GET", "/api/admin/health"],
    ["GET", "/api/admin/families"],
    ["GET", "/api/admin/audit"],
    ["PATCH", `/api/admin/families/${GHOST}`, { name: "x" }],
    ["DELETE", `/api/admin/families/${GHOST}`],
    ["GET", `/api/admin/users/${GHOST}/reminders`],
    ["GET", "/api/families"],
    ["POST", "/api/families", { name: "x" }],
    ["PATCH", `/api/families/${GHOST}`, { name: "x" }],
    ["DELETE", `/api/families/${GHOST}`],
    ["DELETE", `/api/families/${GHOST}/members`],
    ["POST", "/api/families/join", { joinCode: "ABCD2345" }],
    ["GET", "/api/categories"],
    ["POST", "/api/categories", { name: "x" }],
    ["PATCH", `/api/categories/${GHOST}`, { name: "x" }],
    ["DELETE", `/api/categories/${GHOST}`],
    ["GET", "/api/reminders"],
    ["POST", "/api/reminders", { title: "x" }],
    ["GET", `/api/reminders/${GHOST}`],
    ["PATCH", `/api/reminders/${GHOST}`, { title: "x" }],
    ["DELETE", `/api/reminders/${GHOST}`],
    ["POST", `/api/reminders/${GHOST}/complete`, {}],
    ["POST", `/api/reminders/${GHOST}/snooze`, { minutes: 10 }],
    ["GET", "/api/reports/dashboard"],
    ["GET", "/api/reports/overview"],
    ["GET", "/api/reports/recent-activity"],
    ["GET", "/api/templates"],
    ["POST", "/api/templates/import", { pack: "in-household", scope: "mine" }],
    ["POST", `/api/reminders/${GHOST}/acknowledge`],
    ["DELETE", `/api/reminders/${GHOST}/acknowledge`],
    ["GET", `/api/reminders/${GHOST}/comments`],
    ["POST", `/api/reminders/${GHOST}/comments`, { body: "x" }],
    ["DELETE", `/api/reminders/${GHOST}/comments/${GHOST}`],
    ["POST", `/api/reminders/${GHOST}/nudge`],
    ["GET", `/api/families/${GHOST}/activity`],
    ["GET", `/api/families/${GHOST}/scoreboard`],
    ["GET", "/api/contacts"],
    ["POST", "/api/contacts", { email: "x@example.invalid" }],
    ["DELETE", "/api/contacts", { id: GHOST }],
    ["GET", "/api/insights"],
    ["GET", "/api/insights/year"],
    // Builds its own response because the body is a file, so `json()` never sees it and
    // the 401 is hand-written. The one route in the app where forgetting auth would be
    // silent, which is why it is asserted rather than assumed.
    ["GET", "/api/insights/export"],
    ["GET", "/api/notifications"],
    ["PATCH", `/api/notifications/${GHOST}/read`],
    ["PATCH", "/api/notifications/read-all"],
    ["GET", "/api/push/devices"],
    ["DELETE", "/api/push/devices", { id: GHOST }],
    ["POST", "/api/push/subscribe", { endpoint: "https://example.invalid/x" }],
    ["POST", "/api/push/unsubscribe", { endpoint: "https://example.invalid/x" }],
    ["POST", "/api/push/test"],
    ["GET", "/api/sessions"],
    ["DELETE", "/api/sessions", { id: GHOST }],
    ["GET", "/api/settings"],
    ["PATCH", "/api/settings", { timezone: "Asia/Kolkata" }],
    ["POST", "/api/settings/test-email"],
    ["GET", "/api/webauthn/passkeys"],
    ["DELETE", "/api/webauthn/passkeys", { id: GHOST }],
    ["POST", "/api/webauthn/register-options"],
    ["POST", "/api/webauthn/register-verify", {}],
  ];
  for (const [method, path, body] of PROTECTED) {
    check(`${method} ${path} anonymous`, (await anon(method, path, body)).status, 401);
  }

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n3. Methods a route does not declare answer 405");

  const NOT_ALLOWED = [
    ["PUT", "/api/reminders"],
    ["DELETE", "/api/reminders"],
    ["POST", `/api/reminders/${GHOST}`],
    ["GET", "/api/auth/login"],
    ["GET", "/api/auth/logout"],
    ["GET", "/api/families/join"],
    ["GET", `/api/families/${GHOST}/members`],
    ["POST", "/api/users"],
    ["PUT", "/api/settings"],
    ["POST", "/api/sessions"],
    ["GET", "/api/push/test"],
    ["POST", "/api/admin/overview"],
    ["POST", "/api/insights"],
    ["PUT", "/api/templates"],
    ["GET", "/api/templates/import"],
    ["GET", `/api/reminders/${GHOST}/nudge`],
    ["POST", `/api/families/${GHOST}/activity`],
    ["POST", "/api/insights/export"],
  ];
  for (const [method, path] of NOT_ALLOWED) {
    check(`${method} ${path} not allowed`, (await anon(method, path)).status, 405);
  }
  check("GET /api/no-such-route", (await anon("GET", "/api/no-such-route")).status, 404);
  // The approval route was removed with the approval step. 404, not 401 — a route
  // that still existed would answer "not authenticated" to an anonymous caller.
  check(
    "the join-approval route is gone",
    (await anon("GET", `/api/families/${GHOST}/requests`)).status,
    404,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n4. Registration and sign-in validation");

  check(
    "register with no body",
    (await anon("POST", "/api/auth/register", {})).status,
    400,
  );
  check(
    "register with a malformed body",
    (await anon("POST", "/api/auth/register", "{not json", true)).status,
    400,
  );
  check(
    "register with a bad email",
    (await anon("POST", "/api/auth/register", {
      name: "Nope",
      email: "not-an-email",
      pin: "1234",
    })).status,
    400,
  );
  check(
    "register with a 5-digit PIN",
    (await anon("POST", "/api/auth/register", {
      name: "Nope",
      email: "nope@example.invalid",
      pin: "12345",
    })).status,
    400,
  );
  check(
    "register with a 3-digit PIN",
    (await anon("POST", "/api/auth/register", {
      name: "Nope",
      email: "nope@example.invalid",
      pin: "123",
    })).status,
    400,
  );
  check(
    "register with a non-numeric PIN",
    (await anon("POST", "/api/auth/register", {
      name: "Nope",
      email: "nope@example.invalid",
      pin: "abcd",
    })).status,
    400,
  );
  check("login with no body", (await anon("POST", "/api/auth/login", {})).status, 400);
  check(
    "login with a malformed body",
    (await anon("POST", "/api/auth/login", "@@@", true)).status,
    400,
  );
  check(
    "login for an unknown account",
    (await anon("POST", "/api/auth/login", { email: "ghost@example.invalid", pin: "1234" }))
      .status,
    401,
  );
  check(
    "unknown account gets the same message as a wrong PIN",
    (await anon("POST", "/api/auth/login", { email: "ghost@example.invalid", pin: "1234" }))
      .data?.message,
    "Incorrect email or PIN.",
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n5. Seed three accounts");

  await admin("POST", "/api/auth/register", {
    name: "Route Admin",
    email: ADMIN,
    pin: "1234",
  });
  await member("POST", "/api/auth/register", {
    name: "Route Member",
    email: MEMBER,
    pin: "2345",
  });
  const regOut = await outsider("POST", "/api/auth/register", {
    name: "Route Outsider",
    email: OUTSIDER,
    pin: "3456",
  });
  check("third signup lands pending", regOut.data?.status, "pending");
  check(
    "a duplicate email is refused",
    (await anon("POST", "/api/auth/register", {
      name: "Clash",
      email: ADMIN,
      pin: "9876",
    })).status,
    409,
  );

  await prisma.user.updateMany({
    where: { email: { in: [ADMIN, MEMBER, OUTSIDER] } },
    data: { status: "active", role: "member", approvedAt: new Date() },
  });
  await prisma.user.update({ where: { email: ADMIN }, data: { role: "admin" } });

  check(
    "admin signs in",
    (await admin("POST", "/api/auth/login", { email: ADMIN, pin: "1234" })).status,
    200,
  );
  check(
    "member signs in",
    (await member("POST", "/api/auth/login", { email: MEMBER, pin: "2345" })).status,
    200,
  );
  check(
    "outsider signs in",
    (await outsider("POST", "/api/auth/login", { email: OUTSIDER, pin: "3456" })).status,
    200,
  );

  // One request has to carry the whole shell, so assert its shape rather than just
  // its status: a missing key here means a blank app rather than an error.
  const boot = await member("GET", "/api/bootstrap");
  check("bootstrap returns 200", boot.status, 200);
  check("bootstrap carries the user", boot.data?.user?.email, MEMBER);
  check("bootstrap carries settings", boot.data?.settings?.timezone !== undefined, true);
  check("bootstrap carries families", Array.isArray(boot.data?.families), true);
  check("bootstrap carries the badge", typeof boot.data?.badge?.outstanding, "number");
  check(
    "bootstrap carries the unread count",
    typeof boot.data?.badge?.unreadNotifications,
    "number",
  );
  check("bootstrap carries the build id", typeof boot.data?.buildId, "string");
  check(
    "bootstrap never leaks the PIN hash",
    JSON.stringify(boot.data).includes("password_hash"),
    false,
  );

  const badge = await member("GET", "/api/badge");
  check("badge returns 200", badge.status, 200);
  check("badge is just the two numbers", Object.keys(badge.data ?? {}).sort(), [
    "outstanding",
    "unreadNotifications",
  ]);

  const me = await member("GET", "/api/auth/me");
  check("me returns the account", me.data?.email, MEMBER);
  check("me reports accountType", me.data?.accountType, "solo");
  check("me reports role", me.data?.role, "member");
  check("admin me reports admin", (await admin("GET", "/api/auth/me")).data?.role, "admin");

  const memberId = (await prisma.user.findUniqueOrThrow({ where: { email: MEMBER } })).id;
  const outsiderId = (await prisma.user.findUniqueOrThrow({ where: { email: OUTSIDER } })).id;
  const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN } })).id;

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n6. A malformed JSON body is a 400, not a 500");

  const WRITE_ROUTES = [
    ["POST", "/api/reminders"],
    ["POST", "/api/categories"],
    ["PATCH", "/api/settings"],
    ["POST", "/api/families"],
    ["POST", "/api/families/join"],
    ["POST", "/api/webauthn/register-verify"],
  ];
  for (const [method, path] of WRITE_ROUTES) {
    const res = await member(method, path, "{{{ not json", true);
    check(`${method} ${path} with broken JSON`, res.status, 400);
  }
  for (const [method, path] of WRITE_ROUTES) {
    const res = await member(method, path, undefined);
    check(`${method} ${path} with no body at all`, res.status < 500, true);
  }

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n7. Nonexistent ids are 404, never 500");

  const GHOST_TARGETS = [
    ["GET", `/api/reminders/${GHOST}`, 404],
    ["PATCH", `/api/reminders/${GHOST}`, 404, { title: "x" }],
    ["DELETE", `/api/reminders/${GHOST}`, 404],
    ["POST", `/api/reminders/${GHOST}/complete`, 404, {}],
    ["POST", `/api/reminders/${GHOST}/snooze`, 404, { minutes: 10 }],
    ["PATCH", `/api/categories/${GHOST}`, 404, { name: "x" }],
    ["DELETE", `/api/categories/${GHOST}`, 404],
    ["PATCH", `/api/families/${GHOST}`, 404, { name: "x" }],
    ["DELETE", `/api/families/${GHOST}`, 404],
    ["DELETE", `/api/families/${GHOST}/members`, 404],
  ];
  for (const [method, path, expect, body] of GHOST_TARGETS) {
    check(`${method} ${path}`, (await member(method, path, body)).status, expect);
  }
  // Deliberately not a 404: the handler filters an updateMany by owner, so an id
  // that isn't theirs matches nothing and reports zero rather than confirming
  // whether it exists.
  const ghostRead = await member("PATCH", `/api/notifications/${GHOST}/read`);
  check(`PATCH /api/notifications/<unknown>/read`, ghostRead.status, 200);
  check("marking an unknown notification changes nothing", ghostRead.data?.updated, 0);
  check(
    "join with an unknown code",
    (await member("POST", "/api/families/join", { joinCode: "ZZZZZZZZ" })).status,
    404,
  );
  check(
    "join with a too-short code",
    (await member("POST", "/api/families/join", { joinCode: "AB" })).status,
    400,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n8. Admin routes refuse a member");

  const ADMIN_ONLY = [
    ["GET", "/api/users"],
    ["GET", "/api/admin/overview"],
    ["GET", "/api/admin/health"],
    ["GET", "/api/admin/families"],
    ["GET", "/api/admin/audit"],
    ["PATCH", `/api/users/${outsiderId}`, { status: "rejected" }],
    ["DELETE", `/api/users/${outsiderId}`],
    ["PATCH", `/api/admin/families/${GHOST}`, { name: "x" }],
    ["DELETE", `/api/admin/families/${GHOST}`],
    ["GET", `/api/admin/users/${outsiderId}/reminders`],
  ];
  for (const [method, path, body] of ADMIN_ONLY) {
    check(`${method} ${path} as a member`, (await member(method, path, body)).status, 403);
  }
  check("GET /api/users as admin", (await admin("GET", "/api/users")).status, 200);
  check(
    "GET /api/admin/overview as admin",
    (await admin("GET", "/api/admin/overview")).status,
    200,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n9. Admin cannot act on their own row");

  check(
    "admin cannot change their own status",
    (await admin("PATCH", `/api/users/${adminId}`, { status: "rejected" })).status,
    400,
  );
  check(
    "admin cannot delete themselves",
    (await admin("DELETE", `/api/users/${adminId}`)).status,
    400,
  );
  check(
    "PATCH a user with nothing to change",
    (await admin("PATCH", `/api/users/${memberId}`, {})).status,
    400,
  );
  check(
    "PATCH a user with a bogus status",
    (await admin("PATCH", `/api/users/${memberId}`, { status: "banished" })).status,
    400,
  );
  check(
    "PATCH a user with a bogus role",
    (await admin("PATCH", `/api/users/${memberId}`, { role: "wizard" })).status,
    400,
  );
  check(
    "admin PIN reset rejects 5 digits",
    (await admin("PATCH", `/api/users/${memberId}`, { newPin: "12345" })).status,
    400,
  );
  check(
    "PATCH an unknown user",
    (await admin("PATCH", `/api/users/${GHOST}`, { status: "active" })).status,
    404,
  );
  check(
    "DELETE an unknown user",
    (await admin("DELETE", `/api/users/${GHOST}`)).status,
    404,
  );
  check(
    "admin reminder read of an unknown user",
    (await admin("GET", `/api/admin/users/${GHOST}/reminders`)).status,
    404,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n10. Settings validation");

  const SETTINGS_BAD = [
    [{ name: "x" }, 400, "one-character name"],
    [{ timezone: "Mars/Olympus" }, 400, "unknown timezone"],
    [{ defaultTime: "9am" }, 400, "non-HH:mm default time"],
    [{ defaultTime: "25:00" }, 400, "hour out of range"],
    [{ overdueRepeatMins: 1 }, 400, "overdue repeat too small"],
    [{ overdueRepeatMins: 99999 }, 400, "overdue repeat too large"],
    [{ overdueRepeatMins: "soon" }, 400, "non-numeric overdue repeat"],
    [{ idleTimeoutMins: 7 }, 400, "idle timeout not on the list"],
    [{ newPin: "12345" }, 400, "new PIN of 5 digits"],
    [{ newPin: "1234" }, 400, "new PIN without the current one"],
    [{ newPin: "1234", currentPin: "0000" }, 401, "new PIN with the wrong current one"],
  ];
  for (const [body, expect, label] of SETTINGS_BAD) {
    check(`settings rejects ${label}`, (await member("PATCH", "/api/settings", body)).status, expect);
  }
  check(
    "settings accepts a valid change",
    (await member("PATCH", "/api/settings", { timezone: "Asia/Kolkata", defaultTime: "08:30" }))
      .status,
    200,
  );
  const settings = await member("GET", "/api/settings");
  check("settings echoes the timezone", settings.data?.timezone, "Asia/Kolkata");
  check("settings echoes the default time", settings.data?.defaultTime, "08:30");
  check("settings reports pinSet", settings.data?.pinSet, true);
  // Gone on purpose. It existed to badge "signups are waiting for you", which stopped
  // being true when verification replaced approval — a pending account is waiting on
  // its own inbox. Asserted absent rather than deleted, so re-adding the count without
  // re-adding a reason for it trips here.
  check("settings carries no approval queue count", settings.data?.pendingApprovals, undefined);
  check(
    "not even for an admin",
    (await admin("GET", "/api/settings")).data?.pendingApprovals,
    undefined,
  );
  check(
    "settings never returns the PIN hash",
    (settings.data ?? {}).password_hash,
    undefined,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n11. Reminder validation and personal CRUD");

  const myCats = await member("GET", "/api/categories?scope=mine");
  check("personal categories are seeded", myCats.data?.length >= 8, true);
  const catId = myCats.data[0].id;

  check(
    "a reminder needs a title",
    (await member("POST", "/api/reminders", { dueAt: "2026-09-01", categoryId: catId }))
      .status,
    400,
  );
  check(
    "a blank title is not a title",
    (await member("POST", "/api/reminders", {
      title: "   ",
      dueAt: "2026-09-01",
      categoryId: catId,
    })).status,
    400,
  );
  check(
    "a reminder needs a due date",
    (await member("POST", "/api/reminders", { title: "No date", categoryId: catId })).status,
    400,
  );
  check(
    "an unreadable due date is refused",
    (await member("POST", "/api/reminders", {
      title: "Bad date",
      dueAt: "the day after never",
      categoryId: catId,
    })).status,
    400,
  );
  check(
    "a reminder needs a category",
    (await member("POST", "/api/reminders", { title: "No category", dueAt: "2026-09-01" }))
      .status,
    400,
  );
  check(
    "a personal reminder cannot be assigned to anyone",
    (await member("POST", "/api/reminders", {
      title: "Assigned",
      dueAt: "2026-09-01",
      categoryId: catId,
      assignedToId: outsiderId,
    })).status,
    400,
  );
  check(
    "a reminder cannot be filed in a family you are not in",
    (await member("POST", "/api/reminders", {
      title: "Trespass",
      dueAt: "2026-09-01",
      categoryId: catId,
      familyId: GHOST,
    })).status,
    404,
  );

  const created = await member("POST", "/api/reminders", {
    title: "Route smoke reminder",
    dueAt: "2026-09-01T09:00",
    categoryId: catId,
  });
  check("creating a reminder returns 201", created.status, 201);
  const reminderId = created.data?.id;
  check("the reminder has an id", typeof reminderId, "string");
  check("the reminder is personal", created.data?.familyId, null);
  check("the reminder is addressed to the owner", created.data?.audience, "owner");
  check("the title is trimmed", created.data?.title, "Route smoke reminder");
  check("the due time was kept", created.data?.hasTime, true);

  check(
    "a nonsense priority is dropped, not fatal",
    (await member("PATCH", `/api/reminders/${reminderId}`, { priority: "URGENT!!" })).data
      ?.priority,
    "normal",
  );
  check(
    "a nonsense status is dropped too",
    (await member("PATCH", `/api/reminders/${reminderId}`, { status: "banana" })).data?.status,
    "active",
  );
  check(
    "a non-numeric amount does not reach the database",
    (await member("PATCH", `/api/reminders/${reminderId}`, { amount: "lots" })).data?.amount,
    0,
  );
  check(
    "a personal reminder cannot be addressed to a family",
    (await member("PATCH", `/api/reminders/${reminderId}`, { audience: "family" })).status,
    400,
  );
  check(
    "a title cannot be emptied by an update",
    (await member("PATCH", `/api/reminders/${reminderId}`, { title: "" })).status,
    400,
  );

  check(
    "the owner can read it back",
    (await member("GET", `/api/reminders/${reminderId}`)).status,
    200,
  );
  check(
    "another account cannot read it",
    (await outsider("GET", `/api/reminders/${reminderId}`)).status,
    404,
  );
  check(
    "another account cannot edit it",
    (await outsider("PATCH", `/api/reminders/${reminderId}`, { title: "Hijacked" })).status,
    404,
  );
  check(
    "another account cannot delete it",
    (await outsider("DELETE", `/api/reminders/${reminderId}`)).status,
    404,
  );
  check(
    "another account cannot complete it",
    (await outsider("POST", `/api/reminders/${reminderId}/complete`, {})).status,
    404,
  );
  check(
    "an admin gets no back door through the ordinary routes",
    (await admin("GET", `/api/reminders/${reminderId}`)).status,
    404,
  );
  check(
    "an admin does get it through the audited support route",
    (await admin("GET", `/api/admin/users/${memberId}/reminders`)).data?.length,
    1,
  );

  check(
    "snooze needs a sane number of minutes",
    (await member("POST", `/api/reminders/${reminderId}/snooze`, { minutes: 0 })).status,
    400,
  );
  check(
    "snooze rejects a negative number",
    (await member("POST", `/api/reminders/${reminderId}/snooze`, { minutes: -30 })).status,
    400,
  );
  check(
    "snooze rejects a value that is not on the menu",
    (await member("POST", `/api/reminders/${reminderId}/snooze`, { minutes: 37 })).status,
    400,
  );
  check(
    "snooze accepts a real one",
    (await member("POST", `/api/reminders/${reminderId}/snooze`, { minutes: 60 })).status,
    200,
  );
  check(
    "completing works",
    (await member("POST", `/api/reminders/${reminderId}/complete`, { remarks: "done" })).status,
    200,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n12. Query parameters can be given rubbish");

  const PARAM_PROBES = [
    "/api/reminders?scope=mine",
    "/api/reminders?scope=nonsense",
    `/api/reminders?scope=${GHOST}`,
    "/api/reminders?status=active",
    "/api/reminders?status=not-a-status",
    "/api/reminders?scope=&status=",
    "/api/categories?scope=mine",
    "/api/categories?scope=",
    "/api/notifications?take=abc",
  ];
  for (const path of PARAM_PROBES) {
    check(`GET ${path}`, (await member("GET", path)).status, 200);
  }
  check(
    "GET /api/categories?scope=<foreign family>",
    (await member("GET", `/api/categories?scope=${GHOST}`)).status,
    404,
  );

  const AUDIT_PROBES = [
    ["/api/admin/audit", 200],
    ["/api/admin/audit?take=0", 200],
    ["/api/admin/audit?take=-5", 200],
    ["/api/admin/audit?take=99999", 200],
    ["/api/admin/audit?take=abc", 200],
    ["/api/admin/audit?action=nothing.matches.this", 200],
    ["/api/users?q=&status=", 200],
    ["/api/users?status=not-a-status", 200],
    ["/api/users?q=%25%25%25", 200],
  ];
  for (const [path, expect] of AUDIT_PROBES) {
    check(`GET ${path}`, (await admin("GET", path)).status, expect);
  }
  const capped = await admin("GET", "/api/admin/audit?take=99999");
  check("take is capped", capped.data?.length <= 500, true);
  const zeroTake = await admin("GET", "/api/admin/audit?take=0");
  check("take=0 does not return an unbounded list", zeroTake.data?.length <= 500, true);

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n13. Family lifecycle");

  check(
    "a family needs a name",
    (await member("POST", "/api/families", { name: "x" })).status,
    400,
  );
  const fam = await member("POST", "/api/families", { name: FAMILY_NAME });
  check("creating a family returns 201", fam.status, 201);
  const familyId = fam.data?.id;
  const joinCode = fam.data?.joinCode;
  check("the creator is the head", fam.data?.role, "head");
  check("a join code comes back", typeof joinCode, "string");
  check(
    "creating a family flips the account to family",
    (await member("GET", "/api/auth/me")).data?.accountType,
    "family",
  );
  check(
    "the head sees the join code in the list",
    (await member("GET", "/api/families")).data?.[0]?.joinCode,
    joinCode,
  );

  check(
    "an outsider cannot rename it",
    (await outsider("PATCH", `/api/families/${familyId}`, { name: "Stolen" })).status,
    404,
  );
  check(
    "an outsider cannot dissolve it",
    (await outsider("DELETE", `/api/families/${familyId}`)).status,
    404,
  );

  // The code is the permission: a valid one joins outright, with no approval step.
  const join = await outsider("POST", "/api/families/join", { joinCode });
  check("joining with the code returns 201", join.status, 201);
  check("and reports the join", join.data?.status, "joined");
  check("naming the family", join.data?.family, FAMILY_NAME);
  check(
    "the new member sees the family straight away",
    (await outsider("GET", "/api/families")).data?.length,
    1,
  );
  check(
    "and is a plain member, not the head",
    (await outsider("GET", "/api/families")).data?.[0]?.role,
    "member",
  );
  check(
    "joining flips the account to family",
    (await outsider("GET", "/api/auth/me")).data?.accountType,
    "family",
  );
  check(
    "the head's member list now has two",
    (await member("GET", "/api/families")).data?.[0]?.members?.length,
    2,
  );
  check(
    "a plain member does not see the join code",
    (await outsider("GET", "/api/families")).data?.[0]?.joinCode,
    null,
  );
  check(
    "joining a family you are already in",
    (await outsider("POST", "/api/families/join", { joinCode })).status,
    409,
  );

  check(
    "handing headship to yourself",
    (await member("PATCH", `/api/families/${familyId}`, { transferHeadTo: memberId })).status,
    400,
  );
  check(
    "handing headship to a stranger",
    (await member("PATCH", `/api/families/${familyId}`, { transferHeadTo: adminId })).status,
    400,
  );
  check(
    "a member cannot remove another member",
    (await outsider("DELETE", `/api/families/${familyId}/members?userId=${memberId}`)).status,
    403,
  );
  check(
    "rotating the code gives a different one",
    (await member("PATCH", `/api/families/${familyId}`, { rotateCode: true })).data?.joinCode !==
      joinCode,
    true,
  );
  check(
    "the old code no longer works",
    (await admin("POST", "/api/families/join", { joinCode })).status,
    404,
  );

  const famCats = await member("GET", `/api/categories?scope=${familyId}`);
  check("a new family gets its own categories", famCats.data?.length >= 8, true);
  check(
    "a personal category cannot be used on a family reminder",
    (await member("POST", "/api/reminders", {
      title: "Wrong scope",
      dueAt: "2026-09-02",
      familyId,
      categoryId: catId,
    })).status,
    404,
  );

  const famReminder = await member("POST", "/api/reminders", {
    title: "Shared bill",
    dueAt: "2026-09-02",
    familyId,
    categoryId: famCats.data[0].id,
    audience: "family",
  });
  check("a family reminder can be created", famReminder.status, 201);
  check("it lands on the family list", famReminder.data?.familyId, familyId);
  check(
    "another member can see it",
    (await outsider("GET", `/api/reminders/${famReminder.data.id}`)).status,
    200,
  );
  check(
    "another member can complete it",
    (await outsider("POST", `/api/reminders/${famReminder.data.id}/complete`, {})).status,
    200,
  );
  check(
    "a stranger still cannot",
    (await admin("GET", `/api/reminders/${famReminder.data.id}`)).status,
    404,
  );
  check(
    "assigning to someone outside the family",
    (await member("PATCH", `/api/reminders/${famReminder.data.id}`, { assignedToId: adminId }))
      .status,
    400,
  );
  check(
    "assigning to a real member works",
    (await member("PATCH", `/api/reminders/${famReminder.data.id}`, {
      assignedToId: outsiderId,
    })).status,
    200,
  );

  check(
    "dissolving is refused while the shared list has reminders",
    (await member("DELETE", `/api/families/${familyId}`)).status,
    409,
  );
  check(
    "an admin is refused for the same reason",
    (await admin("DELETE", `/api/admin/families/${familyId}`)).status,
    409,
  );
  check(
    "the head cannot leave while others remain",
    (await member("DELETE", `/api/families/${familyId}/members`)).status,
    409,
  );
  check(
    "switching back to a single-person account is refused",
    (await member("PATCH", "/api/settings", { accountType: "solo" })).status,
    409,
  );

  await member("DELETE", `/api/reminders/${famReminder.data.id}`);
  check(
    "a member can leave",
    (await outsider("DELETE", `/api/families/${familyId}/members`)).data?.removed,
    true,
  );
  check(
    "leaving twice",
    (await outsider("DELETE", `/api/families/${familyId}/members`)).status,
    404,
  );
  check(
    "now the head can dissolve it",
    (await member("DELETE", `/api/families/${familyId}`)).data?.deleted,
    true,
  );
  check(
    "and the family is gone",
    (await member("GET", "/api/families")).data?.length,
    0,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n14. Categories");

  const cats = await member("GET", "/api/categories");
  check("categories are seeded on first read", cats.data?.length >= 8, true);
  check(
    "a category needs a name",
    (await member("POST", "/api/categories", { name: "  " })).status,
    400,
  );
  const cat = await member("POST", "/api/categories", { name: "Route Smoke Cat" });
  check("creating a category returns 201", cat.status, 201);
  check(
    "a duplicate name is refused",
    (await member("POST", "/api/categories", { name: "Route Smoke Cat" })).status,
    409,
  );
  check(
    "another account cannot rename it",
    (await outsider("PATCH", `/api/categories/${cat.data.id}`, { name: "Theirs" })).status,
    404,
  );
  check(
    "another account cannot delete it",
    (await outsider("DELETE", `/api/categories/${cat.data.id}`)).status,
    404,
  );
  const filed = await member("POST", "/api/reminders", {
    title: "Filed",
    dueAt: "2026-09-03",
    categoryId: cat.data.id,
  });
  check("a reminder can be filed under it", filed.status, 201);
  check(
    "a category in use is not deleted",
    (await member("DELETE", `/api/categories/${cat.data.id}`)).data?.deleted,
    false,
  );
  await member("DELETE", `/api/reminders/${filed.data.id}`);
  check(
    "an unused category is deleted",
    (await member("DELETE", `/api/categories/${cat.data.id}`)).data?.deleted,
    true,
  );
  check(
    "a foreign category cannot be used on a reminder",
    (await member("POST", "/api/reminders", {
      title: "Foreign category",
      dueAt: "2026-09-04",
      categoryId: GHOST,
    })).status,
    404,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n15. Notifications, devices, sessions");

  check("notifications list", (await member("GET", "/api/notifications")).status, 200);
  check("mark all read", (await member("PATCH", "/api/notifications/read-all")).status, 200);
  check(
    "mark all read twice",
    (await member("PATCH", "/api/notifications/read-all")).status,
    200,
  );
  check("device list", (await member("GET", "/api/push/devices")).status, 200);
  check(
    "subscribe with no endpoint",
    (await member("POST", "/api/push/subscribe", {})).status,
    400,
  );
  // Unsubscribing is idempotent on purpose: the service worker calls it while a
  // device is being torn down, and an error there would be reported to nobody.
  check(
    "unsubscribe with no endpoint reports nothing removed",
    (await member("POST", "/api/push/unsubscribe", {})).data?.removed,
    0,
  );
  check(
    "unsubscribe from an endpoint that was never registered",
    (await member("POST", "/api/push/unsubscribe", { endpoint: "https://example.invalid/nope" }))
      .data?.removed,
    0,
  );
  // These three take ?id=, not a body — asking without one is a 400, and asking
  // with someone else's id blocks/revokes/removes nothing rather than saying
  // whether it exists.
  check(
    "device delete with no id",
    (await member("DELETE", "/api/push/devices")).status,
    400,
  );
  check(
    "blocking a device that is not yours",
    (await member("DELETE", `/api/push/devices?id=${GHOST}`)).data?.blocked,
    0,
  );
  check(
    "purging a device that is not yours",
    (await member("DELETE", `/api/push/devices?id=${GHOST}&purge=1`)).data?.purged,
    0,
  );
  check(
    "revoking every device when there are none",
    (await member("DELETE", "/api/push/devices?all=1")).data?.blocked,
    0,
  );
  const sessions = await member("GET", "/api/sessions");
  check("session list", sessions.status, 200);
  check("at least this session is listed", sessions.data?.length >= 1, true);
  check("one session is marked current", sessions.data?.some((s) => s.current), true);
  check(
    "session delete with no id",
    (await member("DELETE", "/api/sessions")).status,
    400,
  );
  check(
    "revoking a session that is not yours",
    (await member("DELETE", `/api/sessions?id=${GHOST}`)).data?.revoked,
    0,
  );
  check(
    "revoking other sessions when there are none",
    (await member("DELETE", "/api/sessions?others=1")).data?.revoked,
    0,
  );
  check("passkey list", (await member("GET", "/api/webauthn/passkeys")).status, 200);
  check(
    "passkey delete with no id",
    (await member("DELETE", "/api/webauthn/passkeys")).status,
    400,
  );
  check(
    "removing a passkey that is not yours",
    (await member("DELETE", `/api/webauthn/passkeys?id=${GHOST}`)).data?.removed,
    0,
  );
  check(
    "register-options works for a signed-in account",
    (await member("POST", "/api/webauthn/register-options")).status,
    200,
  );
  check(
    "register-verify with rubbish",
    (await member("POST", "/api/webauthn/register-verify", { id: "nope" })).status < 500,
    true,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n16. Reports");

  for (const path of [
    "/api/reports/dashboard",
    "/api/reports/overview",
    "/api/reports/recent-activity",
  ]) {
    check(`GET ${path}`, (await member("GET", path)).status, 200);
  }
  check(
    "recent activity is a list",
    Array.isArray((await member("GET", "/api/reports/recent-activity")).data),
    true,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n17. Admin panel reads");

  const overview = await admin("GET", "/api/admin/overview");
  check("overview has user counts", typeof overview.data?.users?.total, "number");
  check("overview has family count", typeof overview.data?.families, "number");
  check("overview has reminder counts", typeof overview.data?.reminders?.total, "number");
  check("overview embeds health", typeof overview.data?.health?.mailConfigured, "boolean");
  check("overview run list is short", overview.data?.health?.runs?.length <= 3, true);
  const adminHealth = await admin("GET", "/api/admin/health");
  check("health run list is short", adminHealth.data?.runs?.length <= 3, true);
  check("health reports failingDevices", Array.isArray(adminHealth.data?.failingDevices), true);
  check("admin family list", (await admin("GET", "/api/admin/families")).status, 200);
  check(
    "admin audit list is short by default",
    (await admin("GET", "/api/admin/audit")).data?.length <= 3,
    true,
  );
  check(
    "the audited support read left a trail",
    (await admin("GET", "/api/admin/audit?action=admin.read.reminders")).data?.length >= 1,
    true,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n18. Sign-out invalidates the session");

  check("logout", (await member("POST", "/api/auth/logout")).status, 200);
  check("me after logout", (await member("GET", "/api/auth/me")).status, 401);
  check(
    "reminders after logout",
    (await member("GET", "/api/reminders")).status,
    401,
  );
  check("logging out twice", (await member("POST", "/api/auth/logout")).status, 200);

  // A rejected account's live session dies on the next request.
  await prisma.user.update({ where: { id: outsiderId }, data: { status: "rejected" } });
  check(
    "a rejected account's session stops working",
    (await outsider("GET", "/api/reminders")).status,
    401,
  );
  check(
    "and it cannot sign in again",
    (await outsider("POST", "/api/auth/login", { email: OUTSIDER, pin: "3456" })).status,
    403,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n19. Page shells render without a session");

  for (const path of [
    "/",
    "/login",
    "/reminders",
    "/calendar",
    "/categories",
    "/insights",
    "/notifications",
    "/settings",
    "/admin",
    "/admin/accounts",
    "/admin/families",
    "/admin/health",
    "/admin/audit",
  ]) {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    check(`GET ${path}`, res.status, 200);
  }
  const manifest = await fetch(`${BASE}/manifest.json`);
  check("GET /manifest.json", manifest.status, 200);
  check("the manifest names the app", (await manifest.json()).name?.length > 0, true);
  const sw = await fetch(`${BASE}/sw.js`);
  check("GET /sw.js", sw.status, 200);
  const swSource = await sw.text();
  // Served but not listening for push would mean every notification silently goes
  // nowhere, with nothing in any log to say so.
  check(
    "the service worker handles push",
    /addEventListener\(\s*["']push["']/.test(swSource),
    true,
  );
  check(
    "and handles a tap on the notification",
    /addEventListener\(\s*["']notificationclick["']/.test(swSource),
    true,
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
