import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, siteUrl } from "@/lib/public-pages";

/**
 * Allow the public pages, disallow everything else.
 *
 * An allowlist rather than a blocklist, because the blocklist is the version that goes
 * wrong: every route added to this app from now on is private by default, and a
 * disallow list would silently start letting new ones through the day they ship.
 *
 * `Disallow: /` with `Allow:` exceptions is how an allowlist is spelled. Crawlers
 * resolve a conflict by the most specific rule and give ties to Allow, so a longer
 * Allow path always wins over the blanket Disallow.
 *
 * The root needs `/$` and not `/`. Rules match by prefix, so a bare `Allow: /` matches
 * every URL on the site and would quietly undo the whole thing — the one character that
 * decides whether this file allowlists three pages or all of them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: PUBLIC_PAGES.map((p) => (p.path === "/" ? "/$" : p.path)),
        disallow: "/",
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
