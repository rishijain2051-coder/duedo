// Shared safety check for the smoke suites.
//
// These suites seed accounts, drive the real dispatcher and delete what they made.
// Run against a database with real accounts in it, they are disruptive in ways that
// are hard to spot afterwards — a deleted account takes its reminders with it, and
// the dispatcher they drive is the one that mails and pushes to real people.
//
// So: refuse by default unless the database looks like a scratch one.
//
// This is the *outer* guard and it can be waived. The suites that erase a whole table
// — smoke-audit-rotate and smoke-run-history — copy the rows out and put them back
// regardless, because relying on an overridable check is how 188 rows of a real audit
// log were lost once already.

const TEST_DOMAIN = "@example.invalid";

/**
 * Must match SESSION_COOKIE in lib/session.ts.
 *
 * Duplicated because these suites are .mjs and that is .ts — there is no import that
 * works without a build step, and adding one to run a smoke test is a worse trade. One
 * copy here rather than six inline strings: at the DueDo rename every suite was parsing
 * `prosys_session=` out of Set-Cookie by hand, so all six would have failed at once,
 * every assertion reporting as an authorisation failure and none of them pointing at
 * the cookie.
 */
export const SESSION_COOKIE = "duedo_session";

/** The API token prefix, matching lib/api-token.ts. Cosmetic — nothing verifies it. */
export const TOKEN_PREFIX = "duedo_";

/**
 * A year of Family access, spread into whatever a suite seeds its accounts with.
 *
 * Every suite except smoke-plan is testing a feature, not a paywall, and a freshly
 * registered account is on Free — which now means no email, no spending, no voice, no
 * outside contacts and no creating a family. Without this, suites that have nothing to
 * do with billing start failing on it, and the failure reads as a broken feature.
 *
 * smoke-plan.mjs deliberately does *not* use this: the caps are what it is testing.
 */
export const PAID = {
  plan: "family",
  premiumUntil: new Date(Date.now() + 365 * 86_400_000),
};

/**
 * Exits unless every account is a test account (or SMOKE_FORCE=1).
 * `prisma` is passed in so this file needs no client of its own.
 */
export async function assertScratchDatabase(prisma) {
  if (process.env.SMOKE_FORCE === "1") return;

  const real = await prisma.user.count({
    where: { email: { not: { endsWith: TEST_DOMAIN } } },
  });
  if (real === 0) return;

  console.error(
    `Refusing to run: this database has ${real} real account(s) in it.\n` +
      "\n" +
      "These suites create and delete accounts and drive the live dispatcher, which\n" +
      "sends to whatever devices and addresses it finds.\n" +
      "\n" +
      "Point DATABASE_URL at a scratch database, or set SMOKE_FORCE=1 if you are\n" +
      "certain that's what you want.",
  );
  process.exit(1);
}
