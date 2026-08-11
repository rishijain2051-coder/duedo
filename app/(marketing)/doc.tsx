import Link from "next/link";
import { Mark } from "@/components/brand";
import { CONTACT_EMAIL, ENTITY, POLICY_UPDATED, RESPONSE_PROMISE } from "@/lib/legal";

/**
 * The shell every public document sits in: privacy, terms, thank-you, 404.
 *
 * Deliberately without the landing's motion layer. These pages are read once, usually
 * by somebody who is already annoyed, and a headline that animates itself in while they
 * are trying to find a clause is an obstacle rather than a flourish.
 */

interface Crumb {
  label: string;
  href?: string;
}

/**
 * Breadcrumbs, and the matching BreadcrumbList.
 *
 * The JSON-LD is generated from the same array the visible trail renders, so the two
 * cannot drift — a search result showing a path the page does not have is the usual way
 * structured data goes wrong, and it goes wrong silently.
 */
function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const json = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      ...(c.href ? { item: c.href } : {}),
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
      />
      <nav className="doc__crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={c.label} className="contents">
            {c.href ? (
              <Link href={c.href}>{c.label}</Link>
            ) : (
              // The current page is not a link to itself. aria-current is what tells a
              // screen reader which of these is "here".
              <span aria-current="page">{c.label}</span>
            )}
            {i < crumbs.length - 1 && <i aria-hidden="true">/</i>}
          </span>
        ))}
      </nav>
    </>
  );
}

export function Doc({
  title,
  crumbs,
  updated = true,
  children,
}: {
  title: string;
  crumbs: Crumb[];
  /** Off for pages where a policy date would be meaningless, like the 404. */
  updated?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      {/* The way back, on every document. A legal page reached from a search result is
          otherwise a dead end with no evidence of what the product even is. */}
      <header className="nav is-stuck">
        <Link className="nav__brand" href="/">
          <span className="nav__mark">
            <Mark size={30} />
          </span>
          <span className="nav__word">DueDo</span>
        </Link>
        <div className="nav__right">
          <Link className="btn btn--sm" href="/dashboard" prefetch={false}>
            <span>Open web app</span>
          </Link>
        </div>
      </header>

      <main className="doc" id="top">
        <Breadcrumbs crumbs={crumbs} />
        <h1>{title}</h1>
        {updated && (
          <p className="doc__meta">
            Last updated {POLICY_UPDATED} · {ENTITY}
          </p>
        )}
        {children}

        <div className="doc__contact">
          <h2 style={{ marginTop: 0 }}>Getting in touch</h2>
          <p>
            Write to{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and you will get a
            reply <strong>{RESPONSE_PROMISE}</strong>. That covers questions about this
            page, requests to see or delete your data, and anything that has gone wrong.
          </p>
        </div>
      </main>

      <footer className="foot">
        <div className="foot__brand">
          <span className="nav__mark">
            <Mark size={26} />
          </span>
          <b>DueDo</b>
        </div>
        <p>Bills, birthdays, renewals, and the person who said they&apos;d handle it.</p>
        <nav className="foot__links" aria-label="Site">
          <Link href="/">Home</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/dashboard" prefetch={false}>
            Open the app
          </Link>
        </nav>
      </footer>
    </>
  );
}
