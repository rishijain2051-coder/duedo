// Offline sync smoke suite:  node --env-file=.env scripts/smoke-offline.mjs
//
// Two halves, and both matter for the same reason: every interesting part of offline
// sync is a decision made at the moment two writes disagree, and none of those moments
// can be reached by hand. Turning wifi off on a phone, tapping Complete, turning it
// back on and hoping is not a test — it exercises one ordering, once, and says nothing
// about the other five.
//
//   1. The engine, under Node against a fake network. lib/sync.ts is deliberately free
//      of React, IndexedDB and fetch so this is possible at all.
//   2. The routes the engine talks to, against the running dev server, because
//      idempotency the client believes in and the server doesn't have is worse than
//      none: it turns a retry into a duplicate.
//
// Needs the dev server running (npm run dev). Seeds two accounts and a family, then
// deletes them again.

import { readFileSync } from "node:fs";
import vm from "node:vm";
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

const HEAD = "offline-head@example.invalid";
const MEMBER = "offline-member@example.invalid";
const FAMILY_NAME = "Offline Smoke Family";

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(
      `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
    console.log(
      `  FAIL ${name}  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
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
      body: body === undefined ? undefined : JSON.stringify(body),
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
      /* empty or non-JSON */
    }
    return { status: res.status, data };
  };
}

// ─────────────────────────────────────────────────────────── the engine, in Node
//
// lib/sync.ts is TypeScript, and this suite has no build step. It is types-only
// TypeScript though — interfaces and a handful of functions — so stripping the type
// annotations with Node's own transform is enough to run the real file rather than a
// paraphrase of it. A paraphrase is the failure mode worth avoiding here: the whole
// point is to test the shipped decisions.
const { requestFor, readResponse, replay } = await import("../lib/sync.ts");

/** An in-memory OutboxStore, so "survives a restart" can be simulated exactly. */
function memoryStore(initial = []) {
  let rows = [...initial];
  return {
    rows: () => rows,
    all: async () => [...rows].sort((a, b) => a.at - b.at),
    put: async (m) => {
      rows = [...rows.filter((r) => r.id !== m.id), m];
    },
    remove: async (id) => {
      rows = rows.filter((r) => r.id !== id);
    },
  };
}

/** A network that answers from a script, and records what it was asked. */
function fakeNetwork(answers) {
  const seen = [];
  return {
    seen,
    transport: {
      async send(request) {
        seen.push(`${request.method} ${request.path}`);
        const answer = answers.shift();
        if (!answer) return { status: 200 };
        return answer;
      },
    },
  };
}

let n = 0;
function mutation(kind, over = {}) {
  n += 1;
  return {
    id: `m${n}`,
    owner: "u1",
    kind,
    reminderId: "r1",
    at: n,
    payload: {},
    label: `${kind} thing`,
    tries: 0,
    ...over,
  };
}

await assertScratchDatabase(prisma);

async function cleanup() {
  await prisma.family.deleteMany({ where: { name: FAMILY_NAME } });
  await prisma.user.deleteMany({ where: { email: { in: [HEAD, MEMBER] } } });
}

try {
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n1. The service worker parses");
  // Nothing else checks. public/sw.js has no build step, no types and no lint, and a
  // syntax error in it is silent *and* total: the worker fails to evaluate, so push
  // delivery and offline both stop. This exact thing happened — a `**/api` inside a
  // block comment closed the comment early.
  const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  let swError = null;
  try {
    new vm.Script(sw, { filename: "sw.js" });
  } catch (e) {
    swError = e.message;
  }
  check("public/sw.js evaluates", swError, null);
  check(
    "the worker still declares a fetch handler",
    /addEventListener\("fetch"/.test(sw),
    true,
  );
  check(
    "no /api response is ever cached",
    /pathname\.startsWith\("\/api\/"\)/.test(sw),
    true,
  );
  // The rule that stops the worker pinning a stale chunk. An earlier draft of cacheFirst
  // stored every 200 it saw, and because a cache-first hit is returned before the network
  // is consulted, fixing the rule could not heal a device that had already cached under
  // it — the app went on running week-old JavaScript with no symptom but the absence of
  // the change you just made. Only responses the server itself marks immutable are kept.
  check(
    "only immutable responses are stored cache-first",
    /includes\("immutable"\)/.test(sw),
    true,
  );
  check(
    "page documents are network-first, never cache-first",
    /request\.mode === "navigate"[\s\S]{0,80}networkFirst/.test(sw),
    true,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n2. A mutation becomes the right request");
  check(
    "create carries the client-minted id",
    requestFor(mutation("create", { reminderId: "abc", payload: { title: "X" } })),
    { method: "POST", path: "/reminders", body: { title: "X", id: "abc" } },
  );
  check("delete sends no body", requestFor(mutation("delete", { reminderId: "abc" })), {
    method: "DELETE",
    path: "/reminders/abc",
  });
  check(
    "a comment is identified by the mutation's own id",
    requestFor({ ...mutation("comment", { reminderId: "abc" }), id: "note-1", payload: { body: "hi" } }),
    { method: "POST", path: "/reminders/abc/comments", body: { body: "hi", id: "note-1" } },
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n3. Each answer is read the way the plan says");
  check("2xx lands", readResponse(mutation("complete"), { status: 200 }).result, "applied");
  check(
    "a lost connection is deferred, not failed",
    readResponse(mutation("complete"), { status: 0 }).result,
    "deferred",
  );
  check(
    "a server fault is deferred",
    readResponse(mutation("update"), { status: 503 }).result,
    "deferred",
  );
  check(
    "a lapsed session is deferred — a login expiring must never drop a write",
    readResponse(mutation("complete"), { status: 401 }).result,
    "deferred",
  );
  check(
    "deleting something already gone is success",
    readResponse(mutation("delete"), { status: 404 }).result,
    "applied",
  );
  check(
    "completing something deleted is dropped",
    readResponse(mutation("complete"), { status: 404 }).result,
    "superseded",
  );
  check(
    "a second completion of the same cycle is dropped, first wins",
    readResponse(mutation("complete"), { status: 409, message: "Head already marked this done." })
      .result,
    "superseded",
  );
  check(
    "a stale edit is refused, never merged",
    readResponse(mutation("update"), { status: 409 }).result,
    "refused",
  );
  check(
    "a refusal keeps the server's reason",
    readResponse(mutation("update"), { status: 409, message: "It changed elsewhere." }).message,
    "It changed elsewhere.",
  );
  check(
    "a 400 is refused rather than retried forever",
    readResponse(mutation("snooze"), { status: 400 }).result,
    "refused",
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n4. Replaying the queue");

  {
    const store = memoryStore([mutation("create"), mutation("complete")]);
    const net = fakeNetwork([{ status: 201 }, { status: 200 }]);
    const report = await replay(store, net.transport, "u1");
    check("everything lands", [report.applied, report.deferred], [2, 0]);
    check("the queue is emptied", store.rows().length, 0);
    check(
      "in the order it was done in",
      net.seen,
      ["POST /reminders", "POST /reminders/r1/complete"],
    );
  }

  {
    // Idempotency: the same queue replayed twice. The second pass has nothing left to
    // send, which is the property that makes a lost response harmless.
    const store = memoryStore([mutation("complete")]);
    const first = await replay(store, fakeNetwork([{ status: 200 }]).transport, "u1");
    const second = await replay(store, fakeNetwork([{ status: 200 }]).transport, "u1");
    check("replay is idempotent", [first.applied, second.applied], [1, 0]);
  }

  {
    // The double-completion race, from the loser's side.
    const store = memoryStore([mutation("complete")]);
    const report = await replay(
      store,
      fakeNetwork([{ status: 409, message: "Member Person already marked this done." }]).transport,
      "u1",
    );
    check("the loser's completion is dropped", report.superseded, 1);
    check("and it is told who won", report.outcomes[0].message, "Member Person already marked this done.");
    check("nothing is left to retry", store.rows().length, 0);
  }

  {
    // A refused edit stays put, visibly, and is never retried.
    const store = memoryStore([mutation("update")]);
    const report = await replay(store, fakeNetwork([{ status: 409 }]).transport, "u1");
    check("a stale edit is kept for the user to deal with", store.rows().length, 1);
    check("marked so nothing retries it", store.rows()[0].blocked, true);
    check("with the reason attached", typeof store.rows()[0].error, "string");
    check("reported as refused", report.refused, 1);

    // The next replay ignores it rather than hammering an endpoint that will refuse.
    const net = fakeNetwork([{ status: 200 }]);
    const again = await replay(store, net.transport, "u1");
    check("a blocked write is not retried", net.seen.length, 0);
    check("and reports nothing", again.outcomes.length, 0);
  }

  {
    // Ordering: a refusal holds back later writes on the SAME reminder — replaying
    // those would 404 and silently vanish — and nothing else.
    const store = memoryStore([
      mutation("update", { reminderId: "r1" }),
      mutation("complete", { reminderId: "r1" }),
      mutation("complete", { reminderId: "r2" }),
    ]);
    const net = fakeNetwork([{ status: 409 }, { status: 200 }]);
    const report = await replay(store, net.transport, "u1");
    check(
      "the completion behind a refused edit is held",
      report.outcomes.map((o) => o.result),
      ["refused", "held", "applied"],
    );
    check(
      "an unrelated reminder still goes out",
      net.seen,
      ["PATCH /reminders/r1", "POST /reminders/r2/complete"],
    );
  }

  {
    // Losing the connection mid-replay stops the run and keeps everything after it.
    const store = memoryStore([
      mutation("complete", { reminderId: "r1" }),
      mutation("complete", { reminderId: "r2" }),
      mutation("complete", { reminderId: "r3" }),
    ]);
    const net = fakeNetwork([{ status: 200 }, { status: 0 }]);
    const report = await replay(store, net.transport, "u1");
    check("the run stops", report.interrupted, true);
    check("one landed", report.applied, 1);
    check("the rest are still queued", store.rows().length, 2);
    check("and nothing further was attempted", net.seen.length, 2);
  }

  {
    // Surviving a restart: the store is rebuilt from what was persisted, which is what
    // IndexedDB gives us for free, and the replay picks up where it left off.
    const store = memoryStore([mutation("complete", { reminderId: "r9" })]);
    const net = fakeNetwork([{ status: 0 }]);
    await replay(store, net.transport, "u1");
    const persisted = store.rows();
    check("a failed write is persisted", persisted.length, 1);
    check("with its attempt counted", persisted[0].tries, 1);

    const afterRestart = memoryStore(JSON.parse(JSON.stringify(persisted)));
    const report = await replay(afterRestart, fakeNetwork([{ status: 200 }]).transport, "u1");
    check("and lands after a restart", report.applied, 1);
  }

  {
    // A queue belonging to somebody else is never replayed under this session.
    const store = memoryStore([mutation("complete", { owner: "someone-else" })]);
    const net = fakeNetwork([{ status: 200 }]);
    const report = await replay(store, net.transport, "u1");
    check("another account's queue is left alone", net.seen.length, 0);
    check("and reported as nothing to do", report.outcomes.length, 0);
    check("without being thrown away", store.rows().length, 1);
  }

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n5. The routes hold up their end");

  await cleanup();

  const head = session();
  const member = session();

  for (const [call, email, pin, name] of [
    [head, HEAD, "1234", "Offline Head"],
    [member, MEMBER, "2345", "Offline Member"],
  ]) {
    await call("POST", "/api/auth/register", {
      name,
      email,
      pin,
      accountType: "family",
    });
    await prisma.user.update({
      where: { email },
      data: { status: "active", emailVerifiedAt: new Date(), verifyTokenHash: null },
    });
    check(`${name} can sign in`, (await call("POST", "/api/auth/login", { email, pin })).status, 200);
  }

  const family = await head("POST", "/api/families", { name: FAMILY_NAME });
  check("family created", family.status, 201);
  const familyId = family.data.id;
  check(
    "member joins",
    (await member("POST", "/api/families/join", { joinCode: family.data.joinCode })).status,
    201,
  );

  const cats = await head("GET", `/api/categories?scope=${familyId}`);
  const categoryId = cats.data[0].id;

  // ---- a client-minted id makes a replayed create idempotent
  const mintedId = "11111111-1111-4111-8111-111111111111";
  const first = await head("POST", "/api/reminders", {
    id: mintedId,
    title: "Queued bill",
    categoryId,
    dueAt: "2026-08-20T10:00",
    amount: 500,
    familyId,
    audience: "family",
    recurrenceRule: "Monthly",
  });
  check("a create with a client id is accepted", first.status, 201);
  check("and uses that id", first.data.id, mintedId);

  const replayed = await head("POST", "/api/reminders", {
    id: mintedId,
    title: "Queued bill",
    categoryId,
    dueAt: "2026-08-20T10:00",
    familyId,
    audience: "family",
  });
  check("replaying the create is not a second reminder", replayed.data.id, mintedId);
  check(
    "and there is exactly one",
    await prisma.reminder.count({ where: { title: "Queued bill" } }),
    1,
  );
  check(
    "a non-uuid id is refused rather than reaching the database",
    (await head("POST", "/api/reminders", {
      id: "nope",
      title: "x",
      categoryId,
      dueAt: "2026-08-20",
      // Everything else valid, so a 400 can only be about the id. Without the familyId
      // this asks to file a family category on a personal reminder, which is a 404 for
      // an entirely different and correct reason — and the check would pass while
      // proving nothing.
      familyId,
      audience: "family",
    })).status,
    400,
  );

  // ---- one completion per cycle, whoever asks and however often
  const cycle = first.data.dueAt;
  check(
    "the head completes it",
    (await head("POST", `/api/reminders/${mintedId}/complete`, { cycleDueAt: cycle, amount: 500 }))
      .status,
    200,
  );
  const second = await head("POST", `/api/reminders/${mintedId}/complete`, {
    cycleDueAt: cycle,
    amount: 500,
  });
  check("a replay of it is refused", second.status, 409);
  check(
    "and says who settled it",
    second.data.message.includes("Offline Head"),
    true,
  );
  const byMember = await member("POST", `/api/reminders/${mintedId}/complete`, {
    cycleDueAt: cycle,
    amount: 500,
  });
  check("so is the other member paying the same bill twice", byMember.status, 409);
  check(
    "the money is counted once",
    await prisma.reminderHistory.count({ where: { reminderId: mintedId } }),
    1,
  );
  // The reminder rolled forward, so the *next* cycle is a different thing entirely.
  const rolled = await head("GET", `/api/reminders/${mintedId}`);
  check(
    "the next cycle can still be completed",
    (await head("POST", `/api/reminders/${mintedId}/complete`, { cycleDueAt: rolled.data.dueAt }))
      .status,
    200,
  );
  check(
    "a completion with a rubbish cycle is a 400, not a 500",
    (await head("POST", `/api/reminders/${mintedId}/complete`, { cycleDueAt: "not-a-date" }))
      .status,
    400,
  );

  // The race itself, not the sequential case above. Two people tapping Complete in the
  // same instant both pass the route's check — that is what the unique index on
  // (reminderId, cycleDueAt) is for, and the route turns the resulting P2002 into the
  // same 409 rather than a 500. Worth an assertion because the check alone looks
  // sufficient right up until two requests interleave.
  const racing = await head("GET", `/api/reminders/${mintedId}`);
  const raceCycle = racing.data.dueAt;
  const both = await Promise.all([
    head("POST", `/api/reminders/${mintedId}/complete`, { cycleDueAt: raceCycle, amount: 700 }),
    member("POST", `/api/reminders/${mintedId}/complete`, { cycleDueAt: raceCycle, amount: 700 }),
  ]);
  const statuses = both.map((r) => r.status).sort();
  check("exactly one of two simultaneous completions wins", statuses, [200, 409]);
  check(
    "and the loser is told, not 500'd",
    both.find((r) => r.status === 409)?.data?.message?.includes("already marked this done"),
    true,
  );
  check(
    "one history row for that cycle, so the money is counted once",
    await prisma.reminderHistory.count({
      where: { reminderId: mintedId, cycleDueAt: new Date(raceCycle) },
    }),
    1,
  );

  // ---- completing a reminder clears its dedupe ledger
  //
  // The rows are unreachable the moment the reminder moves on, and removing them here is
  // what lets ReminderDispatch hold "cycles still open" rather than a rolling window —
  // which in turn is what lets the due row of an active reminder be kept indefinitely
  // instead of being pruned out from under it. Written by hand because the dispatcher
  // would need real minutes to produce them.
  const ledgerFor = (id) => prisma.reminderDispatch.count({ where: { reminderId: id } });
  const ledgerTarget = await head("POST", "/api/reminders", {
    title: "Has a ledger",
    categoryId,
    dueAt: "2026-08-25T10:00",
    familyId,
    audience: "family",
    recurrenceRule: "Monthly",
  });
  const ledgerId = ledgerTarget.data.id;
  const ledgerCycle = new Date(ledgerTarget.data.dueAt);
  const headId = (await head("GET", "/api/auth/me")).data.id;
  for (const [kind, offsetMin] of [
    ["lead", 1440],
    ["due", 0],
    ["overdue", 60],
    ["escalation", 1440],
  ]) {
    await prisma.reminderDispatch.create({
      data: { reminderId: ledgerId, userId: headId, kind, offsetMin, cycleDueAt: ledgerCycle },
    });
  }
  check("four dedupe rows to start", await ledgerFor(ledgerId), 4);
  check(
    "completing it succeeds",
    (await head("POST", `/api/reminders/${ledgerId}/complete`, {
      cycleDueAt: ledgerCycle.toISOString(),
    })).status,
    200,
  );
  check("and the ledger is empty", await ledgerFor(ledgerId), 0);
  // A completion replayed from an offline queue is refused as already settled, and the
  // clear is a plain delete either way — nothing here depends on it running once.
  check(
    "a replayed completion is still refused",
    (await head("POST", `/api/reminders/${ledgerId}/complete`, {
      cycleDueAt: ledgerCycle.toISOString(),
    })).status,
    409,
  );
  check("and left the ledger alone", await ledgerFor(ledgerId), 0);

  console.log("\n   re-dating a reminder clears it too");
  const nextCycle = (await head("GET", `/api/reminders/${ledgerId}`)).data;
  await prisma.reminderDispatch.create({
    data: {
      reminderId: ledgerId,
      userId: headId,
      kind: "due",
      offsetMin: 0,
      cycleDueAt: new Date(nextCycle.dueAt),
    },
  });
  check("a row on the new cycle", await ledgerFor(ledgerId), 1);
  await head("PATCH", `/api/reminders/${ledgerId}`, { dueAt: "2026-11-30T10:00" });
  // PATCH already documented a moved due instant as a fresh notification cycle; this is
  // that promise carried through to the rows, which would otherwise sit there unreachable
  // for as long as the reminder was never completed.
  check("cleared by the re-dating", await ledgerFor(ledgerId), 0);

  // ---- an edit based on an overtaken version is refused
  const target = await head("POST", "/api/reminders", {
    title: "Editable",
    categoryId,
    dueAt: "2026-09-01T10:00",
    familyId,
    audience: "family",
  });
  const staleVersion = target.data.updatedAt;
  check(
    "an edit based on the current version lands",
    (await head("PATCH", `/api/reminders/${target.data.id}`, {
      title: "Edited once",
      basedOn: staleVersion,
    })).status,
    200,
  );
  // The same person, from a copy that has since been overtaken — a phone that queued an
  // edit while offline while a laptop edited the same reminder. Not the *member*: they
  // may not edit somebody else's reminder at all, so that would be a 403 about
  // permission and would say nothing about versioning.
  const refused = await head("PATCH", `/api/reminders/${target.data.id}`, {
    title: "Edited from an old copy",
    basedOn: staleVersion,
  });
  check("an edit based on an overtaken version is refused", refused.status, 409);
  check(
    "and nothing was overwritten",
    (await head("GET", `/api/reminders/${target.data.id}`)).data.title,
    "Edited once",
  );
  check(
    "an edit with no basedOn still works — nothing had to change to ship this",
    (await head("PATCH", `/api/reminders/${target.data.id}`, { title: "Edited twice" })).status,
    200,
  );
  check(
    "a rubbish basedOn is a 400",
    (await head("PATCH", `/api/reminders/${target.data.id}`, { basedOn: "whenever" })).status,
    400,
  );

  // ---- snooze takes the later value
  const snoozeTarget = await head("POST", "/api/reminders", {
    title: "Snoozable",
    categoryId,
    dueAt: "2026-09-05T10:00",
    familyId,
    audience: "family",
  });
  await head("POST", `/api/reminders/${snoozeTarget.data.id}/snooze`, { minutes: 1440 });
  const long = (await head("GET", `/api/reminders/${snoozeTarget.data.id}`)).data.snoozedUntil;
  await member("POST", `/api/reminders/${snoozeTarget.data.id}/snooze`, { minutes: 10 });
  const after = (await head("GET", `/api/reminders/${snoozeTarget.data.id}`)).data.snoozedUntil;
  check("a shorter snooze can't cut a longer one short", after, long);

  // ---- a note replayed twice is said once
  const noteId = "22222222-2222-4222-8222-222222222222";
  const note = await member("POST", `/api/reminders/${snoozeTarget.data.id}/comments`, {
    id: noteId,
    body: "Paying this on Monday",
  });
  check("a note with a client id is accepted", note.status, 201);
  const noteAgain = await member("POST", `/api/reminders/${snoozeTarget.data.id}/comments`, {
    id: noteId,
    body: "Paying this on Monday",
  });
  check("replaying it returns the same note", noteAgain.data.id, noteId);
  check(
    "and it was only said once",
    (await member("GET", `/api/reminders/${snoozeTarget.data.id}/comments`)).data.length,
    1,
  );

  // ---- acknowledging is already first-wins, which is what a replay needs
  const ack = await member("POST", `/api/reminders/${snoozeTarget.data.id}/acknowledge`);
  check("a member claims it", ack.data.alreadyAcknowledged, false);
  const ackAgain = await member("POST", `/api/reminders/${snoozeTarget.data.id}/acknowledge`);
  check("a replayed claim is a no-op", ackAgain.data.alreadyAcknowledged, true);
  check(
    "and the credit stays with whoever was first",
    (await head("POST", `/api/reminders/${snoozeTarget.data.id}/acknowledge`)).data
      .acknowledgedById,
    ack.data.acknowledgedById,
  );

  // ---- a queued write for something since deleted
  const doomed = await head("POST", "/api/reminders", {
    title: "Doomed",
    categoryId,
    dueAt: "2026-09-09T10:00",
    familyId,
    audience: "family",
  });
  await head("DELETE", `/api/reminders/${doomed.data.id}`);
  check(
    "completing a deleted reminder is a 404, which the engine drops",
    (await head("POST", `/api/reminders/${doomed.data.id}/complete`, {})).status,
    404,
  );
  check(
    "deleting it again is also a 404 — the engine treats that as done",
    (await head("DELETE", `/api/reminders/${doomed.data.id}`)).status,
    404,
  );
} finally {
  await cleanup();
  await prisma.$disconnect();
  await pool.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
