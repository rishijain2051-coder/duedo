import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, siteUrl } from "@/lib/public-pages";
import { POLICY_UPDATED_ISO } from "@/lib/legal";

/**
 * The public pages, as absolute URLs.
 *
 * `lastModified` is the policy date rather than `new Date()`. A sitemap that claims
 * every page changed today, every day, is a sitemap a crawler learns to disbelieve —
 * and then ignores on the day something actually did change.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  // The ISO form, parsed as UTC. See the note in lib/legal.ts for why the readable
  // string must not be parsed here.
  const updated = new Date(`${POLICY_UPDATED_ISO}T00:00:00Z`);

  return PUBLIC_PAGES.map((p) => ({
    url: `${base}${p.path === "/" ? "" : p.path}`,
    lastModified: updated,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
}
