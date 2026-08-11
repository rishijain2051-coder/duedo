/**
 * Every page a signed-out stranger can reach, in one list.
 *
 * app/robots.ts and app/sitemap.ts both read it. Kept together because the failure mode
 * of two lists is silent and one-directional: a page added to the sitemap but not
 * allowed in robots.txt is submitted to a crawler that is then told not to fetch it,
 * and Search Console reports that as an error against a page you just published.
 *
 * Everything not named here is disallowed. That is the right default for this app —
 * every other route needs a session, and a crawler that follows one gets the login
 * screen, indexes it under the wrong URL, and shows a PIN prompt in the search result.
 */
export interface PublicPage {
  path: string;
  /** Relative weight within this site only. Crawlers treat it as a hint at best. */
  priority: number;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
}

export const PUBLIC_PAGES: PublicPage[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/privacy", priority: 0.4, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.4, changeFrequency: "yearly" },
];

/**
 * Public, but deliberately kept out of the sitemap.
 *
 * /thank-you is a destination you arrive at after doing something, not one anybody
 * should find in a search result. It carries `robots: index false` of its own; this
 * list is why it is not also being submitted for indexing at the same time.
 */
export const UNLISTED_PUBLIC_PATHS = ["/thank-you"] as const;

/** The base for absolute URLs. Vercel gives no trailing slash; neither does this. */
export function siteUrl(): string {
  return (process.env.APP_URL ?? "https://duedo.vercel.app").replace(/\/$/, "");
}
