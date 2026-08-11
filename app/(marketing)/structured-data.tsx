import { CONTACT_EMAIL, ENTITY, ENTITY_CITY, ENTITY_COUNTRY } from "@/lib/legal";
import { siteUrl } from "@/lib/public-pages";

/**
 * JSON-LD for the landing page.
 *
 * Three things a search engine can do something with: what the product is, who makes
 * it, and the questions it already answers. The FAQ entries below are the same six
 * questions rendered on the page — structured data that describes content the page does
 * not actually contain is the one mistake here that gets a site penalised rather than
 * ignored, so if a question is edited on the page it must be edited here too.
 *
 * The prices are the real ones, in the real currency, because a rich result showing a
 * price nobody can pay is worse than no rich result.
 */

const FAQ: { q: string; a: string }[] = [
  {
    q: "Do reminders stop if I stop paying?",
    a: "No. Caps limit what you can create, they never touch delivery. If your plan lapses, everything you already made keeps firing on push and in the app. Email is the only channel that switches off, because it is the only one that costs us per message.",
  },
  {
    q: "Why do I have to install it on my iPhone?",
    a: "iOS only delivers web push to an app on the Home Screen, never to a Safari tab. Open DueDo in Safari, tap Share, then Add to Home Screen, and launch it from that icon. Requires iOS 16.4 or later. On Android and desktop it just works.",
  },
  {
    q: "Is my list private from other people in my family?",
    a: "Yes. Family membership adds a second, shared list. It does not open your personal one. Nobody in your household can see your private reminders, and a member who leaves loses access to the shared list immediately.",
  },
  {
    q: "Can an administrator read my reminders?",
    a: "An administrator of the install can, for support, and every single time they do it is written to an audit log that is emailed out daily. We would rather say that plainly than promise privacy we do not deliver.",
  },
  {
    q: "What happens if two of us complete the same bill?",
    a: "First completion wins, and the second person is told who got there first. The money is counted once. Same rule for claiming it.",
  },
  {
    q: "Why annual only, and why no card form?",
    a: "Recurring card payments in India need a registered business, KYC and GST returns: more paperwork than an app this size can justify. One payment a year over UPI, and a date we set by hand, keeps the whole thing honest and cheap.",
  },
];

export function StructuredData() {
  const base = siteUrl();

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${base}/#organization`,
        name: ENTITY,
        url: base,
        logo: `${base}/logo.svg`,
        email: CONTACT_EMAIL,
        address: {
          "@type": "PostalAddress",
          addressLocality: ENTITY_CITY,
          addressCountry: ENTITY_COUNTRY,
        },
      },
      {
        "@type": "WebSite",
        "@id": `${base}/#website`,
        url: base,
        name: "DueDo",
        publisher: { "@id": `${base}/#organization` },
        inLanguage: "en-IN",
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${base}/#app`,
        name: "DueDo",
        applicationCategory: "ProductivityApplication",
        operatingSystem: "Web, iOS, Android",
        url: base,
        description:
          "A reminder app that keeps going after the notification. Advance alerts, a shared household list, and escalation to someone else when nobody answers.",
        publisher: { "@id": `${base}/#organization` },
        // Free is a real, permanent tier rather than a trial, so it is an offer of its
        // own rather than folded into a range. Enterprise is deliberately absent: it has
        // no price, and an offer with no price is not an offer.
        offers: [
          { "@type": "Offer", name: "Free", price: "0", priceCurrency: "INR" },
          {
            "@type": "Offer",
            name: "Individual",
            price: "99",
            priceCurrency: "INR",
            // The billing period matters here: 99 a year and 99 a month are the same
            // number in a rich result unless this says which.
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: "99",
              priceCurrency: "INR",
              billingDuration: 1,
              billingIncrement: 1,
              unitCode: "ANN",
            },
          },
          {
            "@type": "Offer",
            name: "Family",
            price: "299",
            priceCurrency: "INR",
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: "299",
              priceCurrency: "INR",
              billingDuration: 1,
              billingIncrement: 1,
              unitCode: "ANN",
            },
          },
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${base}/#faq`,
        mainEntity: FAQ.map(({ q, a }) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
