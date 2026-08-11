import type { Metadata } from "next";
import Link from "next/link";
import { Doc } from "../doc";
import {
  CONTACT_EMAIL,
  ENTITY,
  ENTITY_COUNTRY,
  JURISDICTION,
  RESPONSE_PROMISE,
} from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The rules for using DueDo: what the plans include, why a lapsed plan never stops a reminder firing, and what the service does and does not promise.",
  alternates: { canonical: "/terms" },
  openGraph: {
    title: "DueDo · Terms of Service",
    description:
      "What the plans include, why a lapsed plan never stops a reminder firing, and what the service promises.",
    url: "/terms",
  },
};

export default function TermsPage() {
  return (
    <Doc
      title="Terms of Service"
      crumbs={[{ label: "DueDo", href: "/" }, { label: "Terms" }]}
    >
      <p className="doc__lede">
        These are the terms on which {ENTITY} provides DueDo. Using the app means
        accepting them. They are written to be read, not to be survived.
      </p>

      <h2>The account</h2>
      <p>
        You need an account, and you confirm your email address before it is activated —
        the confirmation link is what activates it. You are responsible for what happens
        under your account, and for keeping your PIN to yourself. If you think somebody
        else has it, change it and sign the other devices out from the session list in
        Settings.
      </p>
      <p>
        One person, one account. A household shares a family list; it does not share a
        login.
      </p>

      <h2>Plans and payment</h2>
      <ul>
        <li>
          <strong>Free</strong> is free forever, and is a usable product rather than a
          trial with an end date.
        </li>
        <li>
          <strong>Individual</strong> and <strong>Family</strong> are paid once a year,
          by direct transfer. There is no card on file.
        </li>
        <li>
          <strong>Nothing auto-renews.</strong> A plan runs to a date and then stops. You
          will be warned before that date, and nothing is charged without you sending it.
        </li>
      </ul>
      <p>
        Because plans are switched on by hand, there is a human in the loop. Send the
        payment, tell us, and the plan is enabled — you will hear back{" "}
        {RESPONSE_PROMISE}.
      </p>

      <div className="doc__note">
        <p>
          <strong>A lapsed plan never stops a reminder firing.</strong> This is the one
          rule we will not bend. The plan limits govern what you can{" "}
          <em>create</em> — how many reminders and categories, whether voice and outside
          contacts are available — and never what gets <em>delivered</em>. If your plan
          runs out, everything you already made keeps alerting you on push and in the
          app. Email is the only channel that switches off, because it is the only one
          that costs us per message.
        </p>
      </div>

      <h2>Refunds</h2>
      <p>
        If DueDo is not what you expected, write within 14 days of paying and you will
        get the payment back in full, without an argument. After that, a plan runs to the
        date it was bought for. If the service is materially broken for a sustained
        period, contact us and we will sort it out.
      </p>

      <h2>What you may not do</h2>
      <ul>
        <li>
          Use DueDo to harass somebody — the escalation chain reaches real people, and it
          exists so that a bill gets paid, not so somebody can be chased.
        </li>
        <li>
          Add an outside contact who has told you they do not want the emails. Declining
          blocks the address permanently and attempting to work around that is a misuse
          of the service.
        </li>
        <li>
          Try to reach another account&apos;s data, probe the service for weaknesses
          without asking us first, or run automated load against it.
        </li>
        <li>Resell the service, or share one account across a group to avoid the caps.</li>
      </ul>
      <p>
        Accounts doing these things can be suspended. If we suspend yours we will tell you
        why.
      </p>

      <h2>What DueDo promises, and what it does not</h2>
      <p>
        DueDo does its best to deliver every reminder, and the delivery machinery is
        monitored. But it depends on things outside our control: your device, your
        network, your notification permissions, Apple&apos;s and Google&apos;s push
        services, and email providers who make their own decisions about spam.
      </p>
      <p>
        <strong>
          Treat DueDo as a helpful second memory, not as a guarantee.
        </strong>{" "}
        Do not rely on it alone for anything where missing the date is genuinely serious
        — a legal deadline, a court date, a medical dose. The service is provided as-is,
        and to the extent the law allows, {ENTITY} is not liable for anything that
        follows from a reminder that did not arrive. Any liability that cannot be
        excluded is limited to what you paid in the twelve months before the problem.
      </p>
      <p>
        DueDo is a reminder tool. It is not financial, legal, tax or medical advice, and
        the spending figures it shows are a record of what you told it, not accounting.
      </p>

      <h2>Your content</h2>
      <p>
        What you put into DueDo stays yours. We claim no ownership of it and do not use
        it to train anything. We store and transmit it only to run the service — see the{" "}
        <Link href="/privacy">Privacy Policy</Link> for exactly what that means.
      </p>

      <h2>Ending it</h2>
      <p>
        You can delete your account from Settings at any time, and it takes your data
        with it. We may close an account that breaches these terms, or stop offering the
        service altogether — in which case you will get reasonable notice and a chance to
        export what you have.
      </p>

      <h2>Changes</h2>
      <p>
        These terms may change. The date at the top changes when they do, and a change
        that materially affects you will be sent to your account email rather than left
        here to be discovered.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of {ENTITY_COUNTRY}, and the courts of{" "}
        {JURISDICTION} have exclusive jurisdiction over any dispute. Before it gets that
        far, please write to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> — nearly everything is
        settled faster that way.
      </p>
    </Doc>
  );
}
