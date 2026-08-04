// Dispatch run history smoke suite:
//   node --env-file=.env scripts/smoke-run-history.mjs
//
// The rule: keep the newest 10 successful runs, keep every failed one. Successes are
// interchangeable — the 1,440th "ran, sent nothing" says no more than the first — while
// a failure is evidence, and the oldest failure is usually the most useful because it
// is when the problem started.
//
// Guarded: it writes and deletes DispatchRun rows, which are the admin health page's
// only evidence that delivery works.

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

const tick = () =>
  fetch(`${BASE}/api/cron/dispatch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  }).then((r) => r.json());

const counts = async () => ({
  successes: await prisma.dispatchRun.count({ where: { error: null } }),
  failures: await prisma.dispatchRun.count({ where: { error: { not: null } } }),
});

await assertScratchDatabase(prisma);

try {
  await prisma.dispatchRun.deleteMany({});

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n1. Successes are capped at 10");
  // Twelve real ticks, so the prune runs through the code path that records them
  // rather than against rows inserted behind its back.
  for (let i = 0; i < 12; i++) await tick();
  let c = await counts();
  check("twelve ticks leave ten successes", c.successes, 10);
  check("and no failures", c.failures, 0);

  for (let i = 0; i < 5; i++) await tick();
  c = await counts();
  check("five more ticks still leave ten", c.successes, 10);

  const kept = await prisma.dispatchRun.findMany({
    where: { error: null },
    orderBy: { ranAt: "desc" },
    select: { ranAt: true },
  });
  check(
    "the ten kept are the newest ten",
    kept.every((r, i) => i === 0 || r.ranAt <= kept[i - 1].ranAt),
    true,
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n2. Failures are all kept");
  // Planted directly: making the dispatcher fail on demand would mean a switch in
  // production code purely to break it, and the prune is what is under test here.
  const oldest = new Date(Date.now() - 90 * 24 * 3600_000);
  await prisma.dispatchRun.createMany({
    data: Array.from({ length: 14 }, (_, i) => ({
      ranAt: new Date(oldest.getTime() + i * 60_000),
      durationMs: 10,
      considered: 0,
      recipients: 0,
      firedLead: 0,
      firedDue: 0,
      firedOverdue: 0,
      pushesSent: 0,
      pushesFailed: 0,
      emailsSent: 0,
      error: `planted failure ${i}`,
    })),
  });
  check("fourteen failures planted", (await counts()).failures, 14);

  for (let i = 0; i < 4; i++) await tick();
  c = await counts();
  check("further ticks do not touch them", c.failures, 14);
  check("and successes stay capped", c.successes, 10);

  const firstFailure = await prisma.dispatchRun.findFirst({
    where: { error: { not: null } },
    orderBy: { ranAt: "asc" },
    select: { error: true },
  });
  check(
    "the oldest failure survives — it is when the trouble started",
    firstFailure?.error,
    "planted failure 0",
  );

  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n3. The health page still has what it needs");
  const health = await prisma.dispatchRun.findMany({
    orderBy: { ranAt: "desc" },
    take: 3,
  });
  check("three runs to list", health.length, 3);
  check(
    "and a recent one to prove the dispatcher is alive",
    Date.now() - health[0].ranAt.getTime() < 10 * 60_000,
    true,
  );
} finally {
  // Leave only what an idle install would have: the planted failures would otherwise
  // show as red on the admin page forever.
  await prisma.dispatchRun.deleteMany({ where: { error: { not: null } } });
  await prisma.$disconnect();
  await pool.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
