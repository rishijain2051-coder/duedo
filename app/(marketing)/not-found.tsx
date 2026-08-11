import Link from "next/link";
import { Mark } from "@/components/brand";
import { CONTACT_EMAIL, RESPONSE_PROMISE } from "@/lib/legal";

/**
 * The 404 page.
 *
 * Styled as the marketing site rather than the app, because that is who arrives: mostly
 * somebody who followed a stale link or mistyped, and mostly signed out.
 *
 * No `metadata` export — a not-found boundary cannot set one. The title comes from the
 * marketing layout, which is the right fallback: "DueDo · never miss a bill…" is a
 * truthful thing for this tab to say.
 */
export default function NotFound() {
  return (
    <>
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
        <div style={{ textAlign: "center" }}>
          <Mark size={72} className="doc__mark" />
          {/* The number is the smaller half of the message. What somebody needs here is
              the way out, not confirmation that they are lost. */}
          <p className="doc__meta" style={{ marginTop: 26 }}>
            Error 404
          </p>
          <h1 style={{ marginTop: 8 }}>That page isn&apos;t here</h1>
          <p className="doc__lede">
            The link is probably out of date. Nothing has gone wrong with your reminders
            — they are exactly where you left them.
          </p>

          <div className="hero__cta" style={{ marginTop: 36, justifyContent: "center" }}>
            <Link className="btn btn--lg" href="/dashboard" prefetch={false}>
              <span>Open the web app</span>
            </Link>
            <Link className="btn btn--ghost btn--lg" href="/">
              <span>Back to the home page</span>
            </Link>
          </div>
        </div>

        <div className="doc__contact">
          <h2 style={{ marginTop: 0 }}>Looking for something specific?</h2>
          <ul>
            <li>
              <Link href="/">What DueDo does</Link>, including the plans and the
              escalation chain
            </li>
            <li>
              <Link href="/privacy">Privacy Policy</Link> — what is stored and who can
              see it
            </li>
            <li>
              <Link href="/terms">Terms of Service</Link>
            </li>
            <li>
              <Link href="/dashboard" prefetch={false}>
                Your reminders
              </Link>
              , if you already have an account
            </li>
          </ul>
          <p style={{ marginTop: 18 }}>
            If you followed a link from DueDo itself and landed here, that is our bug
            rather than your mistake — tell us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and you will get a
            reply {RESPONSE_PROMISE}.
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
