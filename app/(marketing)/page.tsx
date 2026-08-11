import Link from "next/link";
import LandingMotion from "./landing-motion";
import StickyCta from "./sticky-cta";
import { StructuredData } from "./structured-data";

/**
 * The landing page.
 *
 * A server component with one client child, which is the motion layer and renders
 * nothing. Everything you can read is in the first HTML response, so the page is
 * complete before any JavaScript arrives and stays complete if none ever does.
 *
 * Nothing here is pre-split into word spans, and nothing is cloned. lib/landing-motion.js
 * does both, and it does them in an effect for a reason: rewriting server-rendered text
 * nodes during render is precisely a hydration mismatch, and React answers one by
 * throwing the subtree away and rendering it again on the client.
 *
 * Two destinations, both deliberately out of this route group:
 *
 *   APP     /dashboard, not /login. It reads as "open the app", and the app's own gate
 *           decides what that means — a signed-in visitor lands on their reminders, an
 *           anonymous one is bounced to the PIN screen. Sending everyone to /login
 *           instead would show the sign-in form to people who are already signed in.
 *   UPGRADE /upgrade, which is where the plans and the contact route live.
 *
 * Both cross into the app's root layout, so they are full page loads however they are
 * written. `prefetch={false}` says so honestly rather than fetching an authenticated
 * route on hover for a visitor who has no session to fetch it with.
 */

const APP = "/dashboard";
const UPGRADE = "/upgrade";

export default function LandingPage() {
  return (
    <>
      <div className="grain" aria-hidden="true" />
      <div className="progress" id="progress" aria-hidden="true" />

      <a className="skip" href="#top">
        Skip to content
      </a>

      <header className="nav" id="nav">
        <a className="nav__brand magnetic" href="#top">
          <span className="nav__mark" id="navMark" />
          <span className="nav__word">DueDo</span>
        </a>
        <nav className="nav__links" id="navLinks">
          <a href="#how">How it works</a>
          <a href="#chase">Escalation</a>
          <a href="#money">Spending</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="nav__right">
          <Link className="btn btn--sm magnetic" href={APP} prefetch={false}>
            <span>Open web app</span>
          </Link>
          {/* Labelled, not just three bars: the label is the only thing a screen
              reader has, and aria-expanded is what tells it the state. */}
          <button
            className="nav__toggle"
            id="navToggle"
            type="button"
            aria-expanded="false"
            aria-controls="navLinks"
            aria-label="Open menu"
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </header>

      <main id="top">
        {/* ══════════════ HERO ══════════════ */}
        <section className="hero">
          <div className="aurora" aria-hidden="true">
            <i className="aurora__blob a" />
            <i className="aurora__blob b" />
            <i className="aurora__blob c" />
          </div>
          <div className="hero__inner">
            <div className="hero__mark" id="heroMark" data-parallax="0.14" />

            <h1 className="hero__title">
              <span className="line">
                <span className="split">Everything you owe,</span>
              </span>
              <span className="line">
                <span className="split">before</span> <em className="serif">it</em>{" "}
                <span className="split">owes you.</span>
              </span>
            </h1>

            {/* Deliberately not .reveal: the hero has its own entrance timeline, and
                .reveal sets opacity:0 in CSS, which made gsap.from(opacity:0) animate
                0 to 0 and left both of these permanently invisible. One owner per
                property. */}
            <p className="hero__sub">
              Bills, birthdays, renewals. DueDo warns you a week out, then keeps nagging
              until somebody actually does it.
            </p>

            <div className="hero__cta">
              <Link className="btn btn--lg magnetic" href={APP} prefetch={false}>
                <span>Open the web app</span>
              </Link>
              <a className="btn btn--ghost btn--lg magnetic" href="#how">
                <span>See how it works</span>
              </a>
            </div>
          </div>

          <div className="floaters" aria-hidden="true">
            <article className="notif" data-float>
              <header>
                <span className="notif__dot" />
                DueDo · now
              </header>
              <strong>Electricity bill</strong>
              <p>Due today at 5:30 am · ₹2,140</p>
              <div className="notif__actions">
                <button tabIndex={-1}>Complete</button>
                <button tabIndex={-1}>Snooze 1h</button>
              </div>
            </article>
            <article className="notif notif--b" data-float>
              <header>
                <span className="notif__dot" />
                DueDo · 1 week before
              </header>
              <strong>Passport renewal</strong>
              <p>Due 17 Aug · assigned to Aarav</p>
            </article>
            <article className="notif notif--c" data-float>
              <header>
                <span className="notif__dot is-late" />
                DueDo · overdue
              </header>
              <strong>Society maintenance</strong>
              <p>4 hours late, escalating to Priya</p>
            </article>
          </div>

          <a className="scroll-hint" href="#ticker" aria-label="Scroll to content">
            <i />
          </a>
        </section>

        {/* ══════════════ TICKER (the page's only marquee) ══════════════ */}
        <section className="ticker" id="ticker" aria-hidden="true">
          <div className="ticker__row" data-dir="1">
            <div className="ticker__set">
              <span>Electricity</span>
              <b>·</b>
              <span>Rent</span>
              <b>·</b>
              <span>Car insurance</span>
              <b>·</b>
              <span className="hollow">Mum&apos;s birthday</span>
              <b>·</b>
              <span>GST filing</span>
              <b>·</b>
              <span>Passport</span>
              <b>·</b>
              <span>Credit card</span>
              <b>·</b>
              <span className="hollow">School fees</span>
              <b>·</b>
              <span>Broadband</span>
              <b>·</b>
              <span>Gas cylinder</span>
              <b>·</b>
              <span>Health premium</span>
              <b>·</b>
              <span className="hollow">Vehicle PUC</span>
              <b>·</b>
            </div>
          </div>
        </section>

        {/* ══════════════ MANIFESTO ══════════════ */}
        <section className="manifesto">
          <p className="manifesto__text" id="manifesto">
            Your phone&apos;s reminders app pings once and gives up. A bill doesn&apos;t.
            DueDo keeps going: six advance warnings, an alert at the due time, then an
            hourly nag until somebody hits Complete. And when it&apos;s a shared bill
            nobody has touched, it stops reminding you and starts reminding{" "}
            <em className="serif">them</em>.
          </p>
        </section>

        {/* ══════════════ LADDER ══════════════ */}
        <section className="ladder" id="how">
          <div className="section-head">
            <h2 className="h2 reveal">Six warnings, then it gets impatient</h2>
            <p className="lead reveal">
              Tick the ones you want, per reminder. You always also get one at the due
              time.
            </p>
          </div>

          {/* tabIndex because this scrolls sideways on narrow screens with its scrollbar
              hidden. Browsers do not make scroll containers focusable on their own, so
              without it the last four steps cannot be reached by keyboard at all. */}
          <ol
            className="ladder__track"
            id="ladderTrack"
            tabIndex={0}
            role="group"
            aria-label="Alert schedule, scrolls horizontally"
          >
            <li className="step" data-step>
              <span className="step__t">1 week</span>
              <i />
            </li>
            <li className="step" data-step>
              <span className="step__t">1 day</span>
              <i />
            </li>
            <li className="step" data-step>
              <span className="step__t">4 hours</span>
              <i />
            </li>
            <li className="step" data-step>
              <span className="step__t">1 hour</span>
              <i />
            </li>
            <li className="step" data-step>
              <span className="step__t">30 min</span>
              <i />
            </li>
            <li className="step" data-step>
              <span className="step__t">10 min</span>
              <i />
            </li>
            <li className="step step--due" data-step>
              <span className="step__t">Due</span>
              <i />
            </li>
            <li className="step step--nag" data-step>
              <span className="step__t">Hourly</span>
              <i />
            </li>
          </ol>

          {/* A rule-separated spec strip, not a row of cards. */}
          <dl className="specs">
            <div className="specs__item reveal">
              <dt>Complete or Snooze from the lock screen</dt>
              <dd>
                The push carries both buttons, so you never open the app to deal with it.
              </dd>
            </div>
            <div className="specs__item reveal">
              <dt>The nagging stops at a fortnight</dt>
              <dd>
                Something two weeks late isn&apos;t a reminder any more. It stays visible,
                the alerts stop.
              </dd>
            </div>
            <div className="specs__item reveal">
              <dt>Recurring rolls itself forward</dt>
              <dd>
                Daily to yearly. Complete it and the next date arms automatically, same
                time of day.
              </dd>
            </div>
          </dl>
        </section>

        {/* ══════════════ FEATURES: stacking cards ══════════════ */}
        <section className="stack" id="features">
          <div className="section-head">
            <h2 className="h2 reveal">Built for the bills nobody wants to own</h2>
          </div>

          <div className="stack__cards" id="stackCards">
            <article className="card" data-card>
              <h3>A household list, not a shared login</h3>
              <p>
                Everyone keeps their own account, PIN and devices. A short join code adds
                them to the family. Reminders live either on your private list or the
                shared one, and you pick which when you create them.
              </p>
              <ul className="tags">
                <li>Join codes</li>
                <li>Assign to a member</li>
                <li>Rotate or revoke</li>
              </ul>
            </article>

            <article className="card" data-card>
              <h3>Pick who actually gets told</h3>
              <p>
                Only me, the assigned member, or everyone in the family. Any member can
                complete or snooze a shared item, which is what makes it shared, and
                anyone can leave a note on it, so your household doesn&apos;t need a chat
                app beside it.
              </p>
              <ul className="tags">
                <li>Only me</li>
                <li>The assignee</li>
                <li>Everyone</li>
              </ul>
            </article>

            <article className="card" data-card>
              <h3>“I&apos;ll handle it”</h3>
              <p>
                One tap tells everyone somebody has it, and pauses every escalation on the
                spot. The question it answers is{" "}
                <em className="serif">has anyone seen this</em>, not which of you saw it
                first.
              </p>
              <ul className="tags">
                <li>Stops the chain</li>
                <li>Clears on completion</li>
              </ul>
            </article>

            <article className="card" data-card>
              <h3>Works with no signal at all</h3>
              <p>
                Opens offline and paints from the last copy on your device. Add, edit,
                complete, snooze, claim and comment all queue up and go out when
                you&apos;re back. First completion wins, because two people paying the
                same bill isn&apos;t a conflict to merge.
              </p>
              <ul className="tags">
                <li>Queued writes</li>
                <li>Visible outbox</li>
                <li>No lost taps</li>
              </ul>
            </article>

            <article className="card" data-card>
              <h3>Face ID, and it&apos;s free</h3>
              <p>
                Add a passkey from Settings: Face ID, Touch ID, Windows Hello. Your PIN
                stays as the fallback so a lost device never locks you out. Every active
                login is listed and you can sign any of them out remotely.
              </p>
              <ul className="tags">
                <li>Passkeys</li>
                <li>Session list</li>
                <li>Every tier</li>
              </ul>
            </article>

            <article className="card" data-card>
              <h3>“Hey Siri, add reminder”</h3>
              <p>
                Speak it and DueDo works out the date, the amount, the category and the
                repeat from what you actually said. Anything it isn&apos;t sure about
                stays in the title where you can see it, because a reminder on the wrong
                day is worse than one with no date.
              </p>
              <ul className="tags">
                <li>Apple Shortcuts</li>
                <li>No guessing</li>
              </ul>
            </article>
          </div>
        </section>

        {/* ══════════════ ESCALATION ══════════════ */}
        <section className="chase" id="chase">
          <div className="chase__glow" aria-hidden="true" />
          <div className="section-head section-head--center">
            <h2 className="h2 reveal">When nobody answers, it tells somebody else</h2>
            <p className="lead reveal">
              Up to four steps per reminder.{" "}
              <em className="serif">
                If this still isn&apos;t done four hours late, tell the family head. Eight
                hours, tell the landlord.
              </em>
            </p>
          </div>

          <div className="chain" id="chain">
            <svg
              className="chain__wire"
              viewBox="0 0 1100 120"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="cg" x1="0" x2="1">
                  <stop offset="0%" stopColor="var(--brand)" />
                  <stop offset="60%" stopColor="var(--brand-soft)" />
                  <stop offset="100%" stopColor="var(--hot)" />
                </linearGradient>
              </defs>
              <path
                id="chainWire"
                d="M60 60 H1040"
                fill="none"
                stroke="url(#cg)"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>

            <ol className="chain__nodes">
              <li data-node>
                <span className="chain__when">on time</span>
                <strong>You</strong>
                <p>The reminder fires as normal.</p>
              </li>
              <li data-node>
                <span className="chain__when">4h late</span>
                <strong>The assignee</strong>
                <p>Whoever the shared item was given to.</p>
              </li>
              <li data-node>
                <span className="chain__when">8h late</span>
                <strong>Family head</strong>
                <p>The person who runs the household.</p>
              </li>
              <li data-node className="is-out">
                <span className="chain__when">24h late</span>
                <strong>Outside the app</strong>
                <p>Landlord, accountant, anyone with an email.</p>
              </li>
            </ol>
          </div>

          <p className="chase__foot reveal">
            An outside address is asked <strong>once</strong> whether it wants this at
            all, and nothing reaches it until it agrees. Declining blocks it permanently,
            for everyone.
          </p>
        </section>

        {/* ══════════════ SPENDING ══════════════ */}
        <section className="money" id="money">
          <div className="money__copy">
            <h2 className="h2 reveal">Completing a bill records what you paid</h2>
            <p className="lead reveal">
              It answers roughly what you have been spending and what is about to land.
              There is no financial year to configure and no envelopes to balance, because
              it was never built to be an accounting tool.
            </p>
            <ul className="money__list">
              <li className="reveal">
                <span>This month&apos;s total</span> and a per-category breakdown
              </li>
              <li className="reveal">
                <span>Each category</span> against its own three-month average
              </li>
              <li className="reveal">
                <span>What&apos;s due</span> in the next seven days
              </li>
              <li className="reveal">
                <span>A rolling twelve months</span>, plus CSV download
              </li>
            </ul>
          </div>

          {/* A chart, deliberately not a mock of the app's own screen. */}
          <figure className="chart reveal" data-parallax="0.06">
            <figcaption className="chart__cap">
              <span>August 2026</span>
              <strong className="num count" data-count="18507" data-prefix="₹">
                ₹0
              </strong>
            </figcaption>
            <div className="bars" id="bars">
              <div className="bar" data-bar="86">
                <i />
                <span>
                  Utilities<b className="num">₹6,240</b>
                </span>
              </div>
              <div className="bar" data-bar="64">
                <i />
                <span>
                  Rent<b className="num">₹4,650</b>
                </span>
              </div>
              <div className="bar" data-bar="48">
                <i />
                <span>
                  Insurance<b className="num">₹3,485</b>
                </span>
              </div>
              <div className="bar" data-bar="33">
                <i />
                <span>
                  School<b className="num">₹2,390</b>
                </span>
              </div>
              <div className="bar" data-bar="24">
                <i />
                <span>
                  Subscriptions<b className="num">₹1,742</b>
                </span>
              </div>
            </div>
            <div className="chart__foot">
              <div>
                <span>Next 7 days</span>
                <strong className="num count" data-count="4" data-suffix=" due">
                  0 due
                </strong>
              </div>
              <div>
                <span>vs 3-mo avg</span>
                <strong className="num is-up">+8.4%</strong>
              </div>
            </div>
          </figure>
        </section>

        {/* ══════════════ PRICING ══════════════ */}
        <section className="pricing" id="pricing">
          <div className="section-head section-head--center">
            <h2 className="h2 reveal">
              You pay once a year, and that is the entire billing system
            </h2>
            <p className="lead reveal">
              There is no card on file and nothing auto-renews. A lapse never stops a
              reminder firing, because the caps limit what you can create rather than what
              gets delivered.
            </p>
          </div>

          <div className="tiers">
            <article className="tier tilt" data-tilt>
              <h3>Free</h3>
              <p className="tier__price num">
                <span>₹</span>0<small>forever</small>
              </p>
              <p className="tier__tag">
                Everything one person needs to stop forgetting things.
              </p>
              <ul>
                <li>
                  <b>25</b> reminders a month
                </li>
                <li>
                  <b>15</b> categories
                </li>
                <li>Push and in-app alerts</li>
                <li>All six advance alerts</li>
                <li>Offline queue</li>
                <li>Face ID and passkeys</li>
              </ul>
              <Link className="btn btn--ghost magnetic" href={APP} prefetch={false}>
                <span>Start free</span>
              </Link>
            </article>

            <article className="tier tier--hot tilt" data-tilt>
              <span className="tier__flag">Most people</span>
              <h3>Individual</h3>
              <p className="tier__price num">
                <span>₹</span>99<small>per year</small>
              </p>
              <p className="tier__tag">For one person who wants the whole thing.</p>
              <ul>
                <li>
                  <b>200</b> reminders a month
                </li>
                <li>
                  <b>40</b> categories
                </li>
                <li>Email reminders</li>
                <li>Spending tracker and CSV</li>
                <li>Add by voice</li>
                <li>
                  <b>5</b> outside contacts
                </li>
              </ul>
              <Link className="btn magnetic" href={UPGRADE} prefetch={false}>
                <span>Upgrade for ₹99</span>
              </Link>
            </article>

            <article className="tier tilt" data-tilt>
              <h3>Family</h3>
              <p className="tier__price num">
                <span>₹</span>299<small>per year</small>
              </p>
              <p className="tier__tag">
                One household, one payment, up to four people.
              </p>
              <ul>
                <li>
                  Everything in Individual, <b>×4 people</b>
                </li>
                <li>One shared household list</li>
                <li>Assign, claim, comment</li>
                <li>Activity feed and monthly summary</li>
                <li>
                  <b>20</b> outside contacts
                </li>
                <li>Full escalation chain</li>
              </ul>
              <Link className="btn magnetic" href={UPGRADE} prefetch={false}>
                <span>Upgrade for ₹299</span>
              </Link>
            </article>

            <article className="tier tier--ent tilt" data-tilt>
              <h3>Enterprise</h3>
              <p className="tier__price tier__price--talk">Let&apos;s talk</p>
              <p className="tier__tag">
                Societies, clinics, practices: one admin over many accounts.
              </p>
              <ul>
                <li>Unlimited accounts and families</li>
                <li>Admin panel and PIN resets</li>
                <li>Audit log, emailed daily</li>
                <li>Delivery health dashboard</li>
                <li>Your own sending domain</li>
                <li>Self-hosted option</li>
              </ul>
              <Link className="btn btn--ghost magnetic" href={UPGRADE} prefetch={false}>
                <span>Get in touch</span>
              </Link>
            </article>
          </div>
        </section>

        {/* ══════════════ GET THE APP ══════════════ */}
        <section className="get" id="get">
          <div className="section-head section-head--center">
            <h2 className="h2 reveal">Three ways in, one of them ready today</h2>
          </div>

          {/* Asymmetric on purpose: the live one is the offer, the others are notices. */}
          <div className="platforms">
            <Link className="plat plat--live magnetic" href={APP} prefetch={false}>
              <span className="plat__icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
                  <path d="M2.5 8.6h19" />
                  <path d="M5.4 6.3h.01M7.8 6.3h.01" />
                </svg>
              </span>
              <span className="plat__body">
                <strong>Web app</strong>
                <span className="plat__meta">
                  The whole product, in any browser. Installs to your home screen, and
                  that is what reaches your lock screen.
                </span>
              </span>
              <span className="plat__badge plat__badge--live">Available now</span>
            </Link>

            {/* Not links, and not disabled buttons either: there is nothing to point
                anywhere until those apps exist, and a control that looks pressable and
                does nothing is worse than one that never invited the press. */}
            <div className="plat__soon">
              <div className="plat plat--mini" aria-disabled="true">
                <span className="plat__icon" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
                    <path d="M10.4 5.1h3.2" />
                  </svg>
                </span>
                <span className="plat__body">
                  <strong>iOS</strong>
                  <span className="plat__meta">Native app</span>
                </span>
                <span className="plat__badge">Soon</span>
              </div>
              <div className="plat plat--mini" aria-disabled="true">
                <span className="plat__icon" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5.4 11a6.6 6.6 0 0 1 13.2 0Z" />
                    <path d="M7.7 5.5 6.6 3.8M16.3 5.5l1.1-1.7" />
                    <path d="M9.5 8.3h.01M14.5 8.3h.01" />
                    <rect x="6.6" y="12.7" width="10.8" height="7.4" rx="2.3" />
                  </svg>
                </span>
                <span className="plat__body">
                  <strong>Android</strong>
                  <span className="plat__meta">Native app</span>
                </span>
                <span className="plat__badge">Soon</span>
              </div>
            </div>
          </div>
        </section>

        {/* ══════════════ FAQ ══════════════ */}
        <section className="faq">
          <div className="section-head">
            <h2 className="h2 reveal">The honest answers</h2>
          </div>
          <div className="faq__list">
            <details className="qa">
              <summary>
                Do reminders stop if I stop paying?
                <i aria-hidden="true" />
              </summary>
              <p>
                No, and this is the one rule we won&apos;t bend. Caps limit what you can
                create, they never touch delivery. If your plan lapses, everything you
                already made keeps firing on push and in the app. Email is the only
                channel that switches off, because it&apos;s the only one that costs us
                per message.
              </p>
            </details>

            <details className="qa">
              <summary>
                Why do I have to install it on my iPhone?
                <i aria-hidden="true" />
              </summary>
              <p>
                iOS only delivers web push to an app on the Home Screen, never to a Safari
                tab. Open DueDo in Safari, tap Share, then Add to Home Screen, and launch
                it from that icon. Requires iOS 16.4 or later. On Android and desktop it
                just works.
              </p>
            </details>

            <details className="qa">
              <summary>
                Is my list private from other people in my family?
                <i aria-hidden="true" />
              </summary>
              <p>
                Yes. Family membership adds a second, shared list. It doesn&apos;t open
                your personal one. Nobody in your household can see your private
                reminders, and a member who leaves loses access to the shared list
                immediately.
              </p>
            </details>

            <details className="qa">
              <summary>
                Can an administrator read my reminders?
                <i aria-hidden="true" />
              </summary>
              <p>
                An administrator of the install can, for support, and every single time
                they do it is written to an audit log that&apos;s emailed out daily.
                We&apos;d rather say that plainly here than promise privacy we don&apos;t
                deliver.
              </p>
            </details>

            <details className="qa">
              <summary>
                What happens if two of us complete the same bill?
                <i aria-hidden="true" />
              </summary>
              <p>
                First completion wins, and the second person is told who got there first.
                The money is counted once. Same rule for claiming it.
              </p>
            </details>

            <details className="qa">
              <summary>
                Why annual only, and why no card form?
                <i aria-hidden="true" />
              </summary>
              <p>
                Recurring card payments in India need a registered business, KYC and GST
                returns: more paperwork than an app this size can justify. One payment a
                year over UPI, and a date we set by hand, keeps the whole thing honest and
                cheap.
              </p>
            </details>
          </div>
        </section>

        {/* ══════════════ CTA ══════════════ */}
        <section className="cta">
          <div className="cta__aurora" aria-hidden="true" />
          <h2 className="cta__word" id="ctaWord">
            DueDo
          </h2>
          <div className="cta__row reveal">
            <Link className="btn btn--lg magnetic" href={APP} prefetch={false}>
              <span>Open the web app</span>
            </Link>
            <a className="btn btn--ghost btn--lg magnetic" href="#how">
              <span>Read how it works</span>
            </a>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="foot__brand">
          <span className="nav__mark" id="footMark" />
          <b>DueDo</b>
        </div>
        <p>Bills, birthdays, renewals, and the person who said they&apos;d handle it.</p>
        {/* The only links out of this page that are not calls to action. A landing page
            with no route to its own policies asks people to trust it on nothing. */}
        <nav className="foot__links" aria-label="Site">
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/dashboard" prefetch={false}>
            Open the app
          </Link>
        </nav>
        <small>Made for the household that keeps forgetting. © 2026 DueDo.</small>
      </footer>

      <StickyCta />
      <LandingMotion />
      <StructuredData />
    </>
  );
}
