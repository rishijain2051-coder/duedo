/**
 * What each plan is allowed, and nothing else.
 *
 * Pure on purpose — no imports at all, the same rule lib/dictation.ts follows. The
 * upgrade page is a client component and needs the prices and the caps to render;
 * if this file imported lib/http (which reaches next/headers and Prisma) it could
 * not. Everything that has to *count* rows and refuse a write lives in
 * lib/plan-guard.ts, which is node-only and is the only place that throws.
 *
 * The one rule that matters more than any number below: **caps gate creating, never
 * delivering.** Nothing in lib/dispatch.ts asks about a plan for lead, due or overdue
 * alerts. When someone's access lapses they keep every reminder they have and it keeps
 * firing; they simply cannot add another until they are back under the free cap. A
 * billing lapse silently stopping a medication reminder is the one failure this app
 * cannot afford, and the only way to be sure it can't happen is for the dispatcher to
 * have no opinion about money.
 */

export type PlanId = "free" | "individual" | "family";

export interface PlanLimits {
  /** Reminders that are neither completed nor archived. Concurrent, never a monthly allowance. */
  reminders: number;
  /** Per scope: your own list, and each family's list separately. */
  categories: number;
  /** Outside addresses escalation may reach. */
  contacts: number;
  /** Families this account may *create*. Joining one is free on every plan — that is
   *  the point of the family plan: one person pays and the household joins. */
  familiesOwned: number;
  /** Members per family, counted against the head's plan rather than the joiner's. */
  familyMembers: number;
  /** Reminders delivered by email. Push is unlimited on every plan and costs nothing
   *  to send; email runs through one SMTP account with a daily ceiling, so it is the
   *  channel worth charging for. Never affects transactional mail — verification, PIN
   *  reset and contact consent are not reminders and are never gated. */
  email: boolean;
  /** The Spending view and the yearly totals. */
  spending: boolean;
  /** The API token, and so the Siri / Shortcuts capture path. */
  voice: boolean;
}

export interface PlanSpec {
  id: PlanId;
  name: string;
  /** Whole rupees per year. Null on Free. */
  price: number | null;
  tagline: string;
  limits: PlanLimits;
}

/** One symbol, one place, so changing market is an edit here and nowhere else. */
export const CURRENCY = "₹";

/**
 * Free is deliberately usable forever rather than a trial that runs out.
 *
 * 25 live reminders is more than most people keep, which is the intent: the free tier
 * competes with the phone's built-in reminders app, and losing that comparison on
 * quantity loses it outright. What is held back is the part nothing else does —
 * reminding *other people*, and escalating to a third when they don't respond.
 *
 * Categories are 15 rather than something tidier because DEFAULT_CATEGORIES seeds 8
 * on first load and "Others" makes 9. Any cap below 10 would be breached by a brand
 * new account before it had done anything, which is not a paywall, it is a bug.
 */
export const PLANS: Record<PlanId, PlanSpec> = {
  free: {
    id: "free",
    name: "Free",
    price: null,
    tagline: "Everything one person needs to stop forgetting things.",
    limits: {
      reminders: 25,
      categories: 15,
      contacts: 0,
      familiesOwned: 0,
      familyMembers: 0,
      email: false,
      spending: false,
      voice: false,
    },
  },
  individual: {
    id: "individual",
    name: "Individual",
    price: 99,
    tagline: "For one person who wants the whole thing.",
    limits: {
      reminders: 200,
      categories: 40,
      contacts: 5,
      familiesOwned: 0,
      familyMembers: 0,
      email: true,
      spending: true,
      voice: true,
    },
  },
  family: {
    id: "family",
    name: "Family",
    price: 299,
    tagline: "One household, one payment, up to four people.",
    limits: {
      reminders: 200,
      categories: 40,
      contacts: 20,
      familiesOwned: 1,
      familyMembers: 4,
      email: true,
      spending: true,
      voice: true,
    },
  },
};

/** The order the upgrade page lists them in. */
export const PLAN_ORDER: PlanId[] = ["free", "individual", "family"];

export function isPlanId(value: unknown): value is PlanId {
  return value === "free" || value === "individual" || value === "family";
}

/**
 * `PLANS[id]` for a value that might not be one, falling back to Free.
 *
 * The UI reads settings from a localStorage cache before the network answers, and a
 * blob written by a build that predates `plan` has no such field — so on the first
 * paint after a deploy every `PLANS[settings.plan]` is `PLANS[undefined]`, and reading
 * `.name` off that takes the whole page down with a client-side exception. Nobody sees
 * a stack trace; they see an app that stopped working after an update.
 *
 * Same fallback as effectivePlan, for the same reason: the safe reading of a value
 * nobody can interpret is the one that grants nothing.
 */
export function planSpec(id: unknown): PlanSpec {
  return isPlanId(id) ? PLANS[id] : PLANS.free;
}

/**
 * What to call this account's entitlement on screen.
 *
 * Admins are on ADMIN_PLAN, so naming the plan would say "Family" on the owner's own
 * row — technically true and useless. They are not customers; what matters about that
 * row is which one it is.
 */
export function planTitle(u: {
  plan?: unknown;
  role?: string;
  isRootAdmin?: boolean;
}): string {
  if (u.isRootAdmin) return "Owner";
  if (u.role === "admin") return "Admin";
  return `${planSpec(u.plan).name} plan`;
}

/** True when the entitlement comes from running the install rather than from paying. */
export function isStaff(u: { role?: string; isRootAdmin?: boolean }): boolean {
  return u.isRootAdmin === true || u.role === "admin";
}

/** The plan the install's own staff are on. See effectivePlan. */
export const ADMIN_PLAN: PlanId = "family";

/** The billing fields, as every caller here needs them. */
export interface PlanBearer {
  plan: string;
  premiumUntil: Date | string | null;
  /**
   * `admin` or `member`. Optional so a caller that genuinely only has the billing
   * columns still compiles — but every select that feeds a plan decision should ask
   * for it, because omitting it silently downgrades an admin to Free.
   */
  role?: string;
}

function endOfAccess(user: PlanBearer): number | null {
  if (!user.premiumUntil) return null;
  const at =
    user.premiumUntil instanceof Date
      ? user.premiumUntil.getTime()
      : new Date(user.premiumUntil).getTime();
  return Number.isNaN(at) ? null : at;
}

/**
 * What this account is entitled to *right now*.
 *
 * `plan` alone is never trusted: it says what was bought, and `premiumUntil` says
 * whether it is still owned. Reading them apart is how an expired account keeps its
 * benefits, so they are only ever read together, here.
 *
 * An unrecognised `plan` string degrades to free rather than throwing. It can only
 * arrive by hand-editing the database, and the safe reading of a value nobody can
 * interpret is the one that grants nothing.
 */
export function effectivePlan(user: PlanBearer, now: Date = new Date()): PlanId {
  // Admins run the install and are not customers of it. They get the top plan
  // outright, with no date and nothing to grant — the alternative is the owner paying
  // themselves, or worse, quietly losing email reminders on their own app because
  // nobody thought to hand them a plan. Checked before the date so it cannot expire.
  if (user.role === "admin") return ADMIN_PLAN;

  const until = endOfAccess(user);
  if (until === null || until <= now.getTime()) return "free";
  return isPlanId(user.plan) ? user.plan : "free";
}

export function limitsFor(user: PlanBearer, now?: Date): PlanLimits {
  return PLANS[effectivePlan(user, now)].limits;
}

/**
 * The cheapest plan that would lift a given cap, for the "upgrade to X" line in a
 * refusal. Returns null when nothing higher would help, which currently only happens
 * if a paid plan's own cap is reached — and then the honest answer is to say so
 * rather than to sell them something that changes nothing.
 */
export function nextPlanFor(
  current: PlanId,
  wants: keyof PlanLimits,
): PlanId | null {
  const has = PLANS[current].limits[wants];
  for (const id of PLAN_ORDER) {
    if (PLAN_ORDER.indexOf(id) <= PLAN_ORDER.indexOf(current)) continue;
    const theirs = PLANS[id].limits[wants];
    if (typeof theirs === "boolean" ? theirs && !has : theirs > (has as number)) {
      return id;
    }
  }
  return null;
}
