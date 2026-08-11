/**
 * The facts the legal and contact pages are built from.
 *
 * One module because these strings appear on several pages and in structured data, and
 * a jurisdiction that says Jodhpur in the Terms and something else in the Privacy
 * Policy is not a typo — it is two different documents claiming two different courts.
 *
 * Deliberately not env vars. A privacy policy that renders a blank contact address
 * because a variable was missing on a new deploy is worse than one nobody can change
 * without a commit, and these change roughly never.
 */

export const ENTITY = "Draveta Technologies";
export const ENTITY_CITY = "Jodhpur";
export const ENTITY_STATE = "Rajasthan";
export const ENTITY_COUNTRY = "India";
export const JURISDICTION = `${ENTITY_CITY}, ${ENTITY_STATE}, ${ENTITY_COUNTRY}`;

/**
 * The published contact address.
 *
 * `NEXT_PUBLIC_UPGRADE_EMAIL` may override it, so a deploy can point support somewhere
 * else without a code change — but the fallback is a real address rather than an empty
 * string, because these pages must never render a mailto with nothing in it.
 */
export const CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_UPGRADE_EMAIL || "rishi.jain2051@gmail.com";

/** What the pages promise, as a ceiling rather than a typical case. */
export const RESPONSE_HOURS = 24;
export const RESPONSE_PROMISE = `within ${RESPONSE_HOURS} hours`;

/**
 * Bump these whenever the substance of either document changes, not when a typo is
 * fixed. It is the date a reader uses to decide whether to read it again.
 *
 * Two constants for one date, and they must be kept in step. The alternative — parsing
 * the readable one — is what put 10 August in the sitemap: `new Date("11 August 2026")`
 * is midnight *local*, and this install's local is IST, so the instant it produces is
 * still the previous day in UTC. The ISO form is parsed as UTC and cannot slide.
 */
export const POLICY_UPDATED = "11 August 2026";
export const POLICY_UPDATED_ISO = "2026-08-11";

/** Retention, mirrored from lib/dispatch.ts so the policy states what the code does. */
export const RETENTION = {
  notificationsRead: 14,
  notificationsUnread: 90,
  rollupMonths: 24,
  sessionDays: 30,
} as const;
