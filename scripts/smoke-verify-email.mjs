// Email verification smoke suite:
//   node --env-file=.env scripts/smoke-verify-email.mjs
//
// Verification is what activates a self-registered account now, so the token is a
// bearer credential: whoever holds it turns a stranger's signup into a usable login.
// That makes the interesting assertions the negative ones — a wrong token, a spent
// token, an expired one, and a token for an account an admin already rejected.
//
// The link is read straight out of the database rather than from an inbox, so no mail
// has to leave the machine. Guarded, since it seeds and deletes accounts.

import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHmac } from "node:crypto";
import { assertScratchDatabase } from "./smoke-guard.mjs";

const BASE = process.env.BASE_URL || "http://localhost:3000";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL ?? "")
    ? undefined
    : { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const ALICE = "verify-alice@example.invalid";
const BOB = "verify-bob@example.invalid";
const GHOST_TOKEN = "z".repeat(43);

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

const hashToken = (t) =>
  createHmac("sha256", process.env.AUTH_SECRET || "dev-insecure-secret-change-me")
    .update(t)
    .digest("hex");

const post = (path, body) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

/** Follows a verification link without redirecting, so the outcome is inspectable. */
const follow = async (token) => {
  const res = await fetch(
    `${BASE}/api/auth/verify?token=${encodeURIComponent(token)}`,
    { redirect: "manual" },
  );
  const location = res.headers.get("location") ?? "";
  return {
    status: res.status,
    outcome: new URL(location, BASE).searchParams.get("verified"),
  };
};

/**
 * Issues a token the same way the app does and plants it, so the suite never needs
 * the email itself. Deliberately mirrors lib/verify-email.ts rather than importing it
 * — Node can't load the app's TypeScript directly, and a divergence between the two
 * would show up here as a failure rather than passing silently.
 */
async function plantToken(email, { sentAt = new Date() } = {}) {
  const token = `tok-${Math.random().toString(36).slice(2)}${"x".repeat(24)}`;
  await prisma.user.update({
    where: { email },
    data: { verifyTokenHash: hashToken(token), verifyTokenSentAt: sentAt },
  });
  return token;
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { in: [ALICE, BOB] } } });
}

await assertScratchDatabase(prisma);

try {
  await cleanup();

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n0. No mail leaves the machine for a reserved domain");
  // Every account in every suite uses @example.invalid. Without this guard each
  // registration would attempt a real send: the SMTP server accepts a message for a
  // domain that cannot exist and bounces it later, so the bounces pile up in the
  // sending account's own inbox and `sendMail` reports success it did not have. The
  // audit rotation trusts that return value to decide what to delete.
  const beforeReg = await post("/api/auth/register", {
    name: "Verify Alice",
    email: ALICE,
    pin: "1111",
  });
  check("registration still succeeds", beforeReg.status, 200);
  check("but reports no link was sent", beforeReg.data?.verificationSent, false);
  check(
    "and says an admin is needed instead",
    /admin will need to activate/.test(beforeReg.data?.message ?? ""),
    true,
  );
  await prisma.user.deleteMany({ where: { email: ALICE } });

  console.log("\n1. Signing up leaves the account inert");
  const reg = await post("/api/auth/register", {
    name: "Verify Alice",
    email: ALICE,
    pin: "1111",
  });
  check("registration succeeds", reg.status, 200);
  check("and reports pending", reg.data?.status, "pending");
  let row = await prisma.user.findUnique({ where: { email: ALICE } });
  check("status is pending", row?.status, "pending");
  check("the address is not verified", row?.emailVerifiedAt, null);
  check(
    "a token was issued",
    typeof row?.verifyTokenHash === "string" && row.verifyTokenHash.length === 64,
    true,
  );
  check(
    "the raw token is nowhere in the row",
    JSON.stringify(row).includes("tok-"),
    false,
  );
  check(
    "signing in is refused",
    (await post("/api/auth/login", { email: ALICE, pin: "1111" })).status,
    403,
  );
  check(
    "and the refusal says the address needs confirming",
    (await post("/api/auth/login", { email: ALICE, pin: "1111" })).data
      ?.needsVerification,
    true,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n2. A token that isn't the real one does nothing");
  check("a token that was never issued", (await follow(GHOST_TOKEN)).outcome, "invalid");
  check("an empty token", (await follow("")).outcome, "invalid");
  check("a short token", (await follow("abc")).outcome, "invalid");
  row = await prisma.user.findUnique({ where: { email: ALICE } });
  check("the account is still pending", row?.status, "pending");

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n3. The real token activates it, once");
  const token = await plantToken(ALICE);
  const first = await follow(token);
  check("the link redirects", first.status, 303);
  check("reporting success", first.outcome, "ok");
  row = await prisma.user.findUnique({ where: { email: ALICE } });
  check("the account is active", row?.status, "active");
  check("the address is verified", row?.emailVerifiedAt !== null, true);
  check("approvedAt was stamped", row?.approvedAt !== null, true);
  check("the token was consumed", row?.verifyTokenHash, null);

  check("the same link again is refused", (await follow(token)).outcome, "invalid");
  check(
    "signing in now works",
    (await post("/api/auth/login", { email: ALICE, pin: "1111" })).status,
    200,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n4. An expired link is refused, and says so");
  await post("/api/auth/register", { name: "Verify Bob", email: BOB, pin: "2222" });
  const stale = await plantToken(BOB, {
    sentAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
  });
  check("expired rather than invalid", (await follow(stale)).outcome, "expired");
  check(
    "the account stays pending",
    (await prisma.user.findUnique({ where: { email: BOB } }))?.status,
    "pending",
  );
  // Distinguishable on purpose: "expired" can be recovered from with a resend, and a
  // page that says "invalid" for both sends people looking for a problem they can't
  // find. The token is still spent either way — the fresh one replaces it.
  const fresh = await plantToken(BOB);
  check("a fresh link works", (await follow(fresh)).outcome, "ok");
  check(
    "and the old expired one is dead",
    (await follow(stale)).outcome,
    "invalid",
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n5. A link cannot undo a rejection");
  await prisma.user.update({
    where: { email: BOB },
    data: { status: "rejected", emailVerifiedAt: null },
  });
  const afterReject = await plantToken(BOB);
  check("the link still reports ok", (await follow(afterReject)).outcome, "ok");
  check(
    "but the account stays rejected",
    (await prisma.user.findUnique({ where: { email: BOB } }))?.status,
    "rejected",
  );
  check(
    "and it still cannot sign in",
    (await post("/api/auth/login", { email: BOB, pin: "2222" })).status,
    403,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n6. Resend gives nothing away");
  const answers = await Promise.all([
    post("/api/auth/resend-verification", { email: ALICE }),
    post("/api/auth/resend-verification", { email: "nobody-here@example.invalid" }),
    post("/api/auth/resend-verification", { email: "not-an-email" }),
    post("/api/auth/resend-verification", {}),
  ]);
  check("every reply is 200", answers.map((a) => a.status), [200, 200, 200, 200]);
  check(
    "and every message is identical",
    new Set(answers.map((a) => a.data?.message)).size,
    1,
  );
  check(
    "an active account gets no new token",
    (await prisma.user.findUnique({ where: { email: ALICE } }))?.verifyTokenHash,
    null,
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
