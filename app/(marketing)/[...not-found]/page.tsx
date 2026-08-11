import { notFound } from "next/navigation";

/**
 * Catches every URL that matches no real route, and hands it to not-found.tsx.
 *
 * This exists because the app has two root layouts. Next resolves a global
 * `app/not-found.tsx` against a root layout, and with `app/(app)` and `app/(marketing)`
 * each owning their own `<html>` there is no root layout for it to use — it fails the
 * build with "not-found.tsx doesn't have a root layout" and serves a 500 where the 404
 * should be, which is the worst of both outcomes.
 *
 * A catch-all inside a group has a layout by definition. Real routes still win: route
 * groups are transparent to matching, so /dashboard, /privacy and every /api handler are
 * matched before this is considered, and only genuinely unrouted paths arrive here.
 *
 * `notFound()` rather than rendering the page directly, so the response carries a real
 * 404 status. A pretty page served with 200 is a soft 404 — the visitor cannot tell, but
 * every crawler can, and it indexes the apology.
 */
export default function CatchAll() {
  notFound();
}
