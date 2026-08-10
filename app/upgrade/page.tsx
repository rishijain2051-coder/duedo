"use client";

import Link from "next/link";
import { Check, Mail, MessageCircle, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useApp } from "@/components/app-context";
import { formatDate } from "@/lib/format";
import {
  CURRENCY,
  PLANS,
  PLAN_ORDER,
  planSpec,
  type PlanId,
  type PlanLimits,
} from "@/lib/plan";

/**
 * What each plan costs and how to get one.
 *
 * There is no checkout, on purpose. Taking card payments in India means a registered
 * business, KYC and GST returns — weeks of paperwork to charge a few dozen people —
 * so the flow is: message the owner, pay however suits, and they set the expiry date
 * by hand. At this size that is a fifteen-second job, and the WhatsApp link below is
 * prefilled with the account's email so it isn't fifteen seconds plus a round trip
 * asking which account it was.
 *
 * Every row in the table is read from PLANS rather than written out here, so the page
 * cannot promise something the enforcement in lib/plan-guard.ts doesn't allow.
 */

/** How each entitlement renders. Derived, never a second list of numbers. */
const ROWS: { label: string; of: (l: PlanLimits) => string | boolean }[] = [
  { label: "Live reminders", of: (l) => `${l.reminders}` },
  { label: "Push notifications", of: () => true },
  { label: "Face ID / passkey", of: () => true },
  { label: "Categories", of: (l) => `${l.categories}` },
  { label: "Email reminders", of: (l) => l.email },
  { label: "Spending tracker", of: (l) => l.spending },
  { label: "Add by voice (Siri)", of: (l) => l.voice },
  { label: "Outside contacts", of: (l) => (l.contacts > 0 ? `${l.contacts}` : false) },
  {
    label: "Family members",
    of: (l) => (l.familyMembers > 0 ? `${l.familyMembers}` : false),
  },
];

/**
 * wa.me needs the number in full international form with nothing but digits. Blank is
 * a supported state — an install that would rather be emailed just leaves it unset.
 */
const WHATSAPP = (process.env.NEXT_PUBLIC_UPGRADE_WHATSAPP ?? "").replace(/\D/g, "");
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_UPGRADE_EMAIL ?? "";

/**
 * Button styling on an anchor, because these navigate somewhere.
 *
 * components/ui/button.tsx renders a real `<button>` and has no `asChild`, and a
 * `<button>` wrapping an `<a>` is invalid markup. Going the other way — an onClick with
 * window.open — loses long-press, "copy link", and middle-click, which on a page whose
 * whole purpose is "message this number" are the interactions that matter.
 */
const BTN =
  "inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-medium " +
  "transition-all hover:scale-[1.02] active:scale-[0.98] sm:h-9";

function Value({ v }: { v: string | boolean }) {
  if (v === true) return <Check className="h-4 w-4 text-primary" aria-label="included" />;
  if (v === false)
    return <Minus className="h-4 w-4 text-muted-foreground/50" aria-label="not included" />;
  return <span className="text-sm tabular-nums">{v}</span>;
}

export default function UpgradePage() {
  const { settings, timeZone } = useApp();
  // planSpec, not a bare index: a settings blob cached by an older build has no `plan`
  // at all, and that first paint must not take the page down.
  const current: PlanId = planSpec(settings?.plan).id;
  const until = settings?.premiumUntil ?? null;

  /** Prefilled so the first message already says who is asking and for what. */
  function reach(plan: PlanId): string {
    const body =
      `Hi, I'd like the ${PLANS[plan].name} plan for ${process.env.NEXT_PUBLIC_APP_NAME ?? "DueDo"}.\n` +
      `Account: ${settings?.email ?? ""}`;
    return WHATSAPP
      ? `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(body)}`
      : `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
          `${PLANS[plan].name} plan`,
        )}&body=${encodeURIComponent(body)}`;
  }

  const canContact = Boolean(WHATSAPP || CONTACT_EMAIL);

  return (
    <div className="mx-auto max-w-4xl space-y-4 py-2">
      <div>
        <h1 className="text-xl font-semibold">Plans</h1>
        <p className="text-sm text-muted-foreground">
          {current === "free"
            ? until
              ? `Your ${planSpec(settings?.plan).name} access ended ${formatDate(until, timeZone)}. Everything you had is still here.`
              : "You're on Free. Everything below is optional."
            : `You're on ${PLANS[current].name}${until ? `, until ${formatDate(until, timeZone)}` : ""}.`}
        </p>
      </div>

      {/* One card per plan. Three across on a laptop, stacked on a phone. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const p = PLANS[id];
          const isCurrent = id === current;
          return (
            <Card key={id} className={isCurrent ? "border-primary" : undefined}>
              <CardContent className="space-y-3 p-4">
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium">{p.name}</p>
                    {isCurrent && (
                      <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                        current
                      </span>
                    )}
                  </div>
                  <p className="text-lg font-semibold tabular-nums">
                    {p.price === null ? (
                      "Free"
                    ) : (
                      <>
                        {CURRENCY}
                        {p.price}
                        <span className="text-sm font-normal text-muted-foreground">
                          {" "}
                          / year
                        </span>
                      </>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{p.tagline}</p>
                </div>

                <ul className="space-y-1.5 border-t border-border pt-3">
                  {ROWS.map((row) => (
                    <li
                      key={row.label}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 truncate text-muted-foreground">
                        {row.label}
                      </span>
                      <Value v={row.of(p.limits)} />
                    </li>
                  ))}
                </ul>

                {p.price !== null && !isCurrent && canContact && (
                  <a
                    href={reach(id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${BTN} w-full bg-primary text-primary-foreground shadow hover:bg-primary/90`}
                  >
                    {WHATSAPP ? (
                      <MessageCircle className="mr-1.5 h-4 w-4" />
                    ) : (
                      <Mail className="mr-1.5 h-4 w-4" />
                    )}
                    {until && current !== "free" ? "Renew" : "Get in touch"}
                  </a>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Enterprise. A line, not a column — there is no org model, no seat billing and
          no SSO behind it, so quoting numbers would be selling something that doesn't
          exist. It costs nothing to leave a door open. */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="font-medium">Enterprise</p>
            <p className="text-sm text-muted-foreground">
              More than four people, or something bespoke. Tell us what you need.
            </p>
          </div>
          {canContact && (
            <a
              href={reach("family")}
              target="_blank"
              rel="noopener noreferrer"
              className={`${BTN} border border-border bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground`}
            >
              Talk to us
            </a>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Payment is arranged directly — there is no card form here and never will be.
        Once it lands, your plan is switched on by hand, usually the same day.{" "}
        <strong className="font-medium text-foreground">
          Nothing you have already made is ever deleted or switched off by a plan.
        </strong>{" "}
        If access lapses, every reminder you have keeps firing; you simply can&apos;t
        add new ones until you&apos;re back under the free limit.{" "}
        <Link href="/settings" className="underline underline-offset-2">
          Back to settings
        </Link>
      </p>
    </div>
  );
}
