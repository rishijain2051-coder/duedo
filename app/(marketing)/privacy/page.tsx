import type { Metadata } from "next";
import Link from "next/link";
import { Doc } from "../doc";
import {
  CONTACT_EMAIL,
  ENTITY,
  JURISDICTION,
  RESPONSE_PROMISE,
  RETENTION,
} from "@/lib/legal";

/**
 * Written from what the code does, not from a template.
 *
 * Every claim on this page is checkable against a file in this repository, and where
 * the honest answer is uncomfortable — an administrator can read your reminders — it
 * says so rather than leaving it out. A privacy policy that describes a different
 * product than the one running is the only kind that is worse than none.
 */
export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What DueDo stores, where it lives, who can see it, and how long it is kept. Your face and fingerprint never leave your device — DueDo only ever receives a public key.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "DueDo · Privacy Policy",
    description:
      "What DueDo stores, where it lives, who can see it, and how long it is kept.",
    url: "/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <Doc
      title="Privacy Policy"
      crumbs={[{ label: "DueDo", href: "/" }, { label: "Privacy" }]}
    >
      <p className="doc__lede">
        DueDo is a reminder app run by {ENTITY} from {JURISDICTION}. It holds the things
        you have asked it to remind you about, which is more personal than it sounds — a
        list of your bills is a fair sketch of your life. This page says exactly what is
        stored, who can reach it, and when it is deleted.
      </p>

      <div className="doc__note">
        <p>
          <strong>DueDo has no analytics, no advertising and no third-party trackers.</strong>{" "}
          There is no Google Analytics, no pixel, no session recorder and no cookie
          banner, because there is nothing to consent to. The only cookie set is the one
          that keeps you signed in.
        </p>
      </div>

      <h2>Your face and fingerprint never reach us</h2>
      <p>
        DueDo supports Face ID, Touch ID and Windows Hello for signing in. This is worth
        being precise about, because &ldquo;biometric login&rdquo; usually implies
        somebody is holding a copy of your face.
      </p>
      <p>
        We are not. Passkeys use WebAuthn, where the biometric check happens entirely on
        your own device and is only ever used to unlock a private key stored in that
        device&apos;s secure hardware. What the device sends us is a{" "}
        <strong>public key</strong> and a signature. We store that public key, a
        credential id, a counter and the label you gave the device.
      </p>
      <p>
        <strong>
          {ENTITY} does not collect, receive, store, process or have any means of
          obtaining biometric identifiers or biometric information.
        </strong>{" "}
        No fingerprint, face geometry, iris scan, voiceprint or any other biometric
        measurement is transmitted to our servers, and none could be — the protocol does
        not carry it. Nothing biometric is ever sold, leased, traded or otherwise
        disclosed, because there is nothing of the kind to disclose.
      </p>
      <p>
        Your PIN always remains as a fallback, so losing the device does not lock you
        out, and you can remove a passkey from Settings at any time.
      </p>

      <h2>What is stored</h2>
      <ul>
        <li>
          <strong>Your account</strong> — name, email address, and your PIN stored only
          as a salted hash. The PIN itself is never written down anywhere, so we cannot
          tell you what it is; it can only be reset.
        </li>
        <li>
          <strong>Your reminders</strong> — title, notes, due dates, amounts, category,
          recurrence, who it is assigned to, comments, and whether it was completed.
        </li>
        <li>
          <strong>Your household</strong> — which family you belong to, if any, and the
          reminders shared with it.
        </li>
        <li>
          <strong>Delivery machinery</strong> — push subscriptions for the devices you
          allowed notifications on, passkey public keys, active sessions, and a record of
          which alerts have already been sent so you are not told twice.
        </li>
        <li>
          <strong>An activity log</strong> — significant actions on the account, which is
          what lets you see who completed a shared bill.
        </li>
      </ul>
      <p>
        <strong>No payment details, ever.</strong> There is no card on file and no
        checkout. Plans are paid once a year by direct transfer and switched on by hand,
        so the only thing recorded is a short note saying a payment was received and a
        date the plan runs until.
      </p>

      <h2>Where it lives</h2>
      <ul>
        <li>
          <strong>The database</strong> is PostgreSQL, hosted by Supabase.
        </li>
        <li>
          <strong>The application</strong> is hosted by Vercel.
        </li>
        <li>
          <strong>Email</strong> — reminder emails and confirmation links go out through
          an SMTP provider, which necessarily sees the recipient address and the message.
        </li>
        <li>
          <strong>Push notifications</strong> are delivered through the push service
          belonging to your browser or operating system — Apple, Google or Mozilla. The
          notification content passes through them. If that matters to you, turn push off
          in Settings and use email, or neither.
        </li>
      </ul>

      <h2>Who can see your reminders</h2>
      <p>
        You, and anyone in your family for reminders you put on the shared list. Your
        private list is private: joining a family adds a second list, it does not open
        your own. A member who leaves loses access to the shared list immediately.
      </p>
      <p>
        <strong>An administrator of this install can read reminders for support.</strong>{" "}
        We would rather write that plainly than promise a privacy we do not deliver.
        Every single such read is recorded in an audit log, and that log is emailed to
        the install&apos;s owner once a day, so the access leaves a trail that the person
        doing it cannot quietly remove.
      </p>

      <h2>People outside the app</h2>
      <p>
        Escalation can email somebody who does not have an account — a landlord or an
        accountant. Before anything reaches them they are asked, once, whether they want
        it at all, and nothing is sent until they agree. If they decline, they are
        blocked permanently and for everyone, not just for you.
      </p>

      <h2>How long it is kept</h2>
      <ul>
        <li>
          <strong>Reminders</strong> stay until you delete them or close your account.
        </li>
        <li>
          <strong>Notifications</strong> — {RETENTION.notificationsRead} days once read,{" "}
          {RETENTION.notificationsUnread} days if never read.
        </li>
        <li>
          <strong>Monthly spending summaries</strong> — {RETENTION.rollupMonths} months.
        </li>
        <li>
          <strong>Sessions</strong> — {RETENTION.sessionDays} days, and removed sooner
          when you sign out.
        </li>
      </ul>
      <p>
        Closing your account deletes it and everything attached to it: reminders,
        comments, categories, sessions, passkeys and push subscriptions. Deletion is
        immediate and not recoverable, which is the point of it.
      </p>

      <h2>What you can do</h2>
      <ul>
        <li>See everything held about you, in the app — it is all on your own screens.</li>
        <li>Correct anything, by editing it.</li>
        <li>Export your spending history as CSV.</li>
        <li>Delete your account, from Settings.</li>
        <li>Sign out any device remotely, from the session list in Settings.</li>
        <li>Turn off email, push, or both.</li>
      </ul>
      <p>
        If you would rather ask a person, write to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and you will hear back{" "}
        {RESPONSE_PROMISE}.
      </p>

      <h2>Children</h2>
      <p>
        DueDo is not intended for children under 13, and accounts are not knowingly
        created for them. A family list is meant to be run by the adults in a household.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes in substance, the date at the top changes with it. Please
        see the <Link href="/terms">Terms of Service</Link> for the rules covering the
        service itself.
      </p>
    </Doc>
  );
}
