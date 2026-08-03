// Shared safety check for the smoke suites.
//
// These suites seed accounts, drive the real dispatcher and delete what they made.
// Run against a database with real accounts in it, they are disruptive in ways that
// are hard to spot afterwards: a leftover test user changes who counts as the
// "first account", which is how an install can end up with a pending owner and no
// admin able to approve them.
//
// So: refuse by default unless the database looks like a scratch one.

const TEST_DOMAIN = "@example.invalid";

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
      "These suites create and delete accounts and drive the live dispatcher, so\n" +
      "running them here can disturb real data — and a leftover test account changes\n" +
      "which signup counts as the first one, which is how an install ends up with a\n" +
      "pending owner and no admin to approve them.\n" +
      "\n" +
      "Point DATABASE_URL at a scratch database, or set SMOKE_FORCE=1 if you are\n" +
      "certain that's what you want.",
  );
  process.exit(1);
}
