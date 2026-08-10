import { prisma } from "./db";
import { HttpError } from "./http";
import {
  CURRENCY,
  PLANS,
  effectivePlan,
  limitsFor,
  nextPlanFor,
  type PlanBearer,
  type PlanId,
} from "./plan";

/**
 * The enforcement half of lib/plan.ts. Node-only: it counts rows and throws.
 *
 * Every cap in the app is checked here and nowhere else. Two rules hold it together:
 *
 *   * these are only ever called from a **create** path. Nothing that reads, lists,
 *     completes, edits or *delivers* asks about a plan, which is what makes a lapse
 *     safe — see the note at the top of lib/plan.ts.
 *   * the count is taken immediately before the insert. There is no cached counter to
 *     drift, no monthly reset to schedule, and no timezone to argue about, because
 *     nothing accumulates: delete a reminder and the slot is free again that instant.
 *
 * A refusal is 402, which is the one status that means exactly this and is otherwise
 * unused here — services/api.ts keys the upgrade prompt off it rather than off the
 * wording of a message.
 */

/** Payment Required. Distinct from 403 so the client can tell "pay" from "not yours". */
export const PLAN_LIMIT_STATUS = 402;

function priceOf(id: PlanId): string {
  const p = PLANS[id].price;
  return p === null ? "free" : `${CURRENCY}${p} a year`;
}

/**
 * "…, or upgrade to Individual for ₹99 a year." — appended only when a higher plan
 * would actually lift *this* cap. Being sold something that changes nothing is worse
 * than a bare refusal.
 */
function upsell(current: PlanId, wants: Parameters<typeof nextPlanFor>[1]): string {
  const next = nextPlanFor(current, wants);
  if (!next) return "";
  return ` ${PLANS[next].name} covers it, for ${priceOf(next)} — see Upgrade.`;
}

function refuse(message: string): never {
  throw new HttpError(PLAN_LIMIT_STATUS, message);
}

// ---------------------------------------------------------------- feature gates

const FEATURE_COPY: Record<
  "email" | "spending" | "voice",
  { needs: "email" | "spending" | "voice"; noun: string }
> = {
  email: { needs: "email", noun: "Email reminders are" },
  spending: { needs: "spending", noun: "The spending tracker is" },
  voice: { needs: "voice", noun: "Adding reminders by voice is" },
};

/** Refuses a paid-only feature. Never called for transactional mail. */
export function assertFeature(
  user: PlanBearer,
  feature: "email" | "spending" | "voice",
  now?: Date,
): void {
  const plan = effectivePlan(user, now);
  if (PLANS[plan].limits[feature]) return;
  const { noun, needs } = FEATURE_COPY[feature];
  refuse(`${noun} a paid feature.${upsell(plan, needs)}`);
}

/**
 * The same question without the throw, for rendering a page rather than refusing a
 * write. Kept beside assertFeature so the two can never drift apart.
 */
export function hasFeature(
  user: PlanBearer,
  feature: "email" | "spending" | "voice",
  now?: Date,
): boolean {
  return limitsFor(user, now)[feature];
}

// -------------------------------------------------------------------- row caps

/**
 * Live reminders: everything not completed and not archived.
 *
 * A recurring reminder counts once however often it fires — completing it rolls the
 * due date forward and leaves the row active, which is the honest reading, because it
 * is still a standing commitment the dispatcher has to carry.
 *
 * Counted by owner regardless of which list it lands on, so a family reminder counts
 * against whoever wrote it rather than against the household. Any other split makes
 * "how many do I have left" unanswerable without knowing everyone else's total.
 */
export async function assertReminderRoom(
  user: PlanBearer & { id: string },
  now?: Date,
): Promise<void> {
  const plan = effectivePlan(user, now);
  const cap = PLANS[plan].limits.reminders;
  const live = await prisma.reminder.count({
    where: { userId: user.id, status: { notIn: ["completed", "archived"] } },
  });
  if (live < cap) return;
  refuse(
    `You have ${live} live reminders, which is the ${PLANS[plan].name} limit. ` +
      `Complete or delete one to free a slot.${upsell(plan, "reminders")}`,
  );
}

/**
 * Categories, per scope: your own list and each family's list are counted separately,
 * because they are separate lists and a household's shared categories are not yours.
 */
export async function assertCategoryRoom(
  user: PlanBearer,
  scope: { userId: string } | { familyId: string },
  now?: Date,
): Promise<void> {
  const plan = effectivePlan(user, now);
  const cap = PLANS[plan].limits.categories;
  const held = await prisma.category.count({ where: scope });
  if (held < cap) return;
  refuse(
    `That list already has ${held} categories, which is the ${PLANS[plan].name} limit.` +
      upsell(plan, "categories"),
  );
}

export async function assertContactRoom(
  user: PlanBearer & { id: string },
  now?: Date,
): Promise<void> {
  const plan = effectivePlan(user, now);
  const cap = PLANS[plan].limits.contacts;
  if (cap === 0) {
    refuse(
      `Outside contacts are a paid feature — they are how a reminder can reach ` +
        `someone who doesn't use the app.${upsell(plan, "contacts")}`,
    );
  }
  const held = await prisma.externalContact.count({ where: { ownerId: user.id } });
  if (held < cap) return;
  refuse(
    `You have ${held} contacts, which is the ${PLANS[plan].name} limit.` +
      upsell(plan, "contacts"),
  );
}

// -------------------------------------------------------------------- families

/** Creating a household. Joining one is free — see the note on `familiesOwned`. */
export async function assertFamilyRoom(
  user: PlanBearer & { id: string },
  now?: Date,
): Promise<void> {
  const plan = effectivePlan(user, now);
  const cap = PLANS[plan].limits.familiesOwned;
  if (cap === 0) {
    refuse(
      `Creating a family is part of the Family plan.${upsell(plan, "familiesOwned")}`,
    );
  }
  const headOf = await prisma.familyMember.count({
    where: { userId: user.id, role: "head" },
  });
  if (headOf < cap) return;
  refuse(
    `You already run ${headOf} ${headOf === 1 ? "family" : "families"}, which is the ` +
      `${PLANS[plan].name} limit.${upsell(plan, "familiesOwned")}`,
  );
}

/**
 * Room for one more member, charged to the **head's** plan rather than the joiner's.
 *
 * That is the whole shape of the family plan: one person pays ₹299 and the household
 * joins for nothing. Billing the joiner instead would mean four payments for one
 * household, which is not what is being sold.
 *
 * Neither message names the head's billing state. Whoever typed a join code is often
 * a stranger to it, and "that account hasn't paid" is not theirs to be told.
 */
export async function assertFamilySeat(familyId: string, now?: Date): Promise<void> {
  const head = await prisma.familyMember.findFirst({
    where: { familyId, role: "head" },
    select: { user: { select: { plan: true, premiumUntil: true } } },
  });

  // A headless family is a data anomaly, not a billing state: deleting an account
  // cascades its membership row away and can leave one behind. Falling back to the
  // paid cap keeps a household that was paid for from being locked out by it; the
  // remaining members can transfer headship and put it right.
  const cap = head
    ? PLANS[effectivePlan(head.user, now)].limits.familyMembers
    : PLANS.family.limits.familyMembers;

  const members = await prisma.familyMember.count({ where: { familyId } });
  if (cap > 0 && members < cap) return;

  refuse(
    members >= PLANS.family.limits.familyMembers
      ? `That family is full — ${members} of ${PLANS.family.limits.familyMembers} members.`
      : `That family can't take another member right now. Ask whoever set it up.`,
  );
}
