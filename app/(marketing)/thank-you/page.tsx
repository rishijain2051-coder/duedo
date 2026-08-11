import type { Metadata } from "next";
import Link from "next/link";
import { Doc } from "../doc";
import { CONTACT_EMAIL, RESPONSE_HOURS, RESPONSE_PROMISE } from "@/lib/legal";

/**
 * Where somebody lands after sending an upgrade request.
 *
 * The page exists because the handoff is to WhatsApp or email — the person leaves the
 * app to send a message and comes back with no idea whether anything is in motion.
 * "Sent" is not a state the app can observe, so the honest job here is to say what
 * happens next and by when, and to give them something to do in the meantime.
 *
 * noindex: it is a destination you arrive at, not one anybody should find in a search
 * result, and an indexed thank-you page is a small but real credibility leak.
 */
export const metadata: Metadata = {
  title: "Thank you",
  description: "Your upgrade request is in. Here is what happens next.",
  robots: { index: false, follow: true },
};

export default function ThankYouPage() {
  return (
    <Doc
      title="Thank you — that's in"
      crumbs={[{ label: "DueDo", href: "/" }, { label: "Thank you" }]}
      updated={false}
    >
      <p className="doc__lede">
        Your request has been sent. Nothing else is needed from you right now.
      </p>

      <h2>What happens next</h2>
      <ol>
        <li>
          <strong>We read it and reply {RESPONSE_PROMISE}.</strong> Usually the same day.
          If {RESPONSE_HOURS} hours pass with nothing, assume the message went astray
          rather than that it is being ignored, and write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </li>
        <li>
          <strong>Your plan is switched on by hand.</strong> There is no checkout to
          complete and no card to enter — a person sets the date the plan runs until.
        </li>
        <li>
          <strong>The app tells you.</strong> Next time you open DueDo you will get a
          note confirming the upgrade. You do not need to sign out and back in.
        </li>
      </ol>

      <div className="doc__note">
        <p>
          <strong>Nothing is paused while you wait.</strong> Every reminder you already
          have keeps firing exactly as before. The plan changes what you can create, not
          what gets delivered.
        </p>
      </div>

      <h2>While you wait</h2>
      <ul>
        <li>
          <Link href="/dashboard" prefetch={false}>Open the app</Link> and add the next
          thing you are likely to forget.
        </li>
        <li>
          On an iPhone, install DueDo to the Home Screen — iOS only delivers push to an
          app launched from that icon, never to a Safari tab.
        </li>
        <li>
          Add a passkey from Settings, so signing in is Face ID rather than four digits.
        </li>
        <li>
          Have a look at <Link href="/">how the escalation chain works</Link> if you have
          not set one up yet.
        </li>
      </ul>
    </Doc>
  );
}
