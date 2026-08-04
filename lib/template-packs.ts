import { LEAD_OFFSET_VALUES, parseLocalDateTime } from "./time";

// Starter packs.
//
// The hardest part of a reminder app is the empty list. Somebody signs up, sees a blank
// page and a "New reminder" button, and has to remember everything they wanted reminding
// about — which is the problem they came here to solve. A pack turns that into one tap
// and a checklist of things they can recognise.
//
// Data, not database rows. A pack is a fixed list that ships with the build; there is no
// reason for it to be editable at runtime, and a table would need seeding, migrating and
// keeping in step across environments to gain nothing.
//
// Community-shared packs are deliberately absent. Hosting lists other people wrote means
// moderation and a report path, which is a product rather than a feature of this one.

/** Days before the due date to send an advance alert. Must be from LEAD_OFFSET_VALUES. */
const WEEK = 10080;
const DAY = 1440;
const FOUR_HOURS = 240;

export type Recurrence =
  | "One Time"
  | "Daily"
  | "Weekly"
  | "Monthly"
  | "Quarterly"
  | "Half-Yearly"
  | "Yearly";

export interface PackItem {
  /**
   * Stable identity, `<pack>/<item>`. Stored on the created reminder as `templateKey`, so
   * importing a pack twice adds only what is missing and the preview can say what you
   * already have. Never renumber these — a changed key silently re-imports.
   */
  key: string;
  title: string;
  /** Category name. Created in the target scope if there isn't one by this name. */
  category: string;
  recurrence: Recurrence;
  /**
   * When in the calendar it lands. `month` is 1-based and only meaningful for yearly
   * items; `day` is the day of the month. Resolved to the *next* occurrence in the
   * importer's own timezone at import time.
   *
   * Omitted entirely for things whose date is personal — a birthday belongs to a person,
   * not to a pack — and those import with the date left for the user to set.
   */
  on?: { month?: number; day: number };
  leadOffsets: number[];
  /**
   * A hint, not a claim. Shown in the preview and saved as the reminder's amount so the
   * spending view has something to work with; every one of them is meant to be edited.
   */
  amount?: number;
  /** Why this is in the pack, when the title alone doesn't say. */
  note?: string;
}

export interface Pack {
  id: string;
  name: string;
  blurb: string
  items: PackItem[];
}

export const PACKS: Pack[] = [
  {
    id: "in-household",
    name: "Indian household",
    blurb: "The paperwork and payments that come round every year whether you remember or not.",
    items: [
      {
        key: "in-household/lic-premium",
        title: "LIC premium",
        category: "Insurance",
        recurrence: "Yearly",
        on: { day: 15 },
        leadOffsets: [WEEK, DAY],
        amount: 25000,
        note: "Lapsing costs the policy, not just a late fee — hence a week's warning.",
      },
      {
        key: "in-household/vehicle-insurance",
        title: "Vehicle insurance renewal",
        category: "Vehicle",
        recurrence: "Yearly",
        leadOffsets: [WEEK, DAY],
        amount: 8000,
        note: "Driving uninsured is the actual risk here.",
      },
      {
        key: "in-household/puc",
        title: "PUC certificate renewal",
        category: "Vehicle",
        recurrence: "Half-Yearly",
        leadOffsets: [WEEK],
        amount: 100,
      },
      {
        key: "in-household/fastag",
        title: "Top up FASTag",
        category: "Vehicle",
        recurrence: "Monthly",
        on: { day: 1 },
        leadOffsets: [DAY],
        amount: 1000,
      },
      {
        key: "in-household/society-maintenance",
        title: "Society maintenance",
        category: "Utility Bills",
        recurrence: "Monthly",
        on: { day: 5 },
        leadOffsets: [DAY],
        amount: 3500,
      },
      {
        key: "in-household/electricity",
        title: "Electricity bill",
        category: "Utility Bills",
        recurrence: "Monthly",
        on: { day: 10 },
        leadOffsets: [DAY, FOUR_HOURS],
        amount: 2000,
      },
      {
        key: "in-household/gas-cylinder",
        title: "Book gas cylinder",
        category: "Utility Bills",
        recurrence: "Monthly",
        on: { day: 20 },
        leadOffsets: [DAY],
        amount: 900,
      },
      {
        key: "in-household/mobile-recharge",
        title: "Mobile recharge",
        category: "Utility Bills",
        recurrence: "Monthly",
        on: { day: 25 },
        leadOffsets: [DAY],
        amount: 400,
      },
      {
        key: "in-household/broadband",
        title: "Broadband bill",
        category: "Utility Bills",
        recurrence: "Monthly",
        on: { day: 7 },
        leadOffsets: [DAY],
        amount: 800,
      },
      {
        key: "in-household/health-insurance",
        title: "Health insurance renewal",
        category: "Insurance",
        recurrence: "Yearly",
        leadOffsets: [WEEK, DAY],
        amount: 20000,
      },
      {
        key: "in-household/passport-check",
        title: "Check passport expiry",
        category: "Taxes",
        recurrence: "Yearly",
        leadOffsets: [WEEK],
        note: "Renewal takes weeks, and most countries want six months left on it.",
      },
      {
        key: "in-household/itr",
        title: "File income tax return",
        category: "Taxes",
        recurrence: "Yearly",
        on: { month: 7, day: 20 },
        leadOffsets: [WEEK, DAY],
        note: "Ahead of the 31 July deadline, with room to find the documents.",
      },
    ],
  },
  {
    id: "homeowner",
    name: "Homeowner",
    blurb: "Bills and renewals attached to the house rather than to you.",
    items: [
      {
        key: "homeowner/property-tax",
        title: "Property tax",
        category: "Taxes",
        recurrence: "Yearly",
        on: { month: 4, day: 20 },
        leadOffsets: [WEEK, DAY],
        amount: 12000,
        note: "Most municipalities give a rebate for paying early in the year.",
      },
      {
        key: "homeowner/water-tax",
        title: "Water charges",
        category: "Utility Bills",
        recurrence: "Quarterly",
        leadOffsets: [DAY],
        amount: 1200,
      },
      {
        key: "homeowner/home-insurance",
        title: "Home insurance renewal",
        category: "Insurance",
        recurrence: "Yearly",
        leadOffsets: [WEEK, DAY],
        amount: 6000,
      },
      {
        key: "homeowner/ac-service",
        title: "AC servicing",
        category: "Health / Medicine",
        recurrence: "Half-Yearly",
        leadOffsets: [WEEK],
        amount: 1500,
      },
      {
        key: "homeowner/water-tank",
        title: "Clean the water tank",
        category: "Health / Medicine",
        recurrence: "Half-Yearly",
        leadOffsets: [WEEK],
      },
      {
        key: "homeowner/pest-control",
        title: "Pest control",
        category: "Health / Medicine",
        recurrence: "Yearly",
        leadOffsets: [WEEK],
        amount: 2500,
      },
      {
        key: "homeowner/home-loan-emi",
        title: "Home loan EMI",
        category: "EMI / Loans",
        recurrence: "Monthly",
        on: { day: 5 },
        leadOffsets: [DAY],
        amount: 35000,
      },
    ],
  },
  {
    id: "family-life",
    name: "Family life",
    blurb: "The dates that matter to people rather than to institutions.",
    items: [
      {
        key: "family-life/school-fees",
        title: "School fees",
        category: "EMI / Loans",
        recurrence: "Quarterly",
        leadOffsets: [WEEK, DAY],
        amount: 25000,
      },
      {
        key: "family-life/parent-teacher",
        title: "Parent–teacher meeting",
        category: "Birthdays",
        recurrence: "Quarterly",
        leadOffsets: [WEEK, DAY],
      },
      {
        key: "family-life/dentist",
        title: "Dental check-up",
        category: "Health / Medicine",
        recurrence: "Half-Yearly",
        leadOffsets: [WEEK],
        amount: 800,
      },
      {
        key: "family-life/health-checkup",
        title: "Annual health check-up",
        category: "Health / Medicine",
        recurrence: "Yearly",
        leadOffsets: [WEEK],
        amount: 3000,
      },
      {
        key: "family-life/vaccinations",
        title: "Check vaccination schedule",
        category: "Health / Medicine",
        recurrence: "Yearly",
        leadOffsets: [WEEK],
      },
      {
        // No date: a birthday belongs to a person, and guessing one would be worse
        // than leaving the field for them to fill in.
        key: "family-life/birthday",
        title: "Birthday",
        category: "Birthdays",
        recurrence: "Yearly",
        leadOffsets: [WEEK, DAY],
        note: "Set the date and rename it — one per person you want reminding about.",
      },
      {
        key: "family-life/anniversary",
        title: "Anniversary",
        category: "Birthdays",
        recurrence: "Yearly",
        leadOffsets: [WEEK, DAY],
      },
    ],
  },
  {
    id: "freelancer",
    name: "Freelancer",
    blurb: "Filings and follow-ups that nobody else is going to chase for you.",
    items: [
      {
        key: "freelancer/gstr-1",
        title: "File GSTR-1",
        category: "Taxes",
        recurrence: "Monthly",
        on: { day: 8 },
        leadOffsets: [DAY, FOUR_HOURS],
        note: "Before the 11th, with a few days to reconcile invoices.",
      },
      {
        key: "freelancer/gstr-3b",
        title: "File GSTR-3B",
        category: "Taxes",
        recurrence: "Monthly",
        on: { day: 17 },
        leadOffsets: [DAY, FOUR_HOURS],
        note: "Before the 20th. Late filing carries interest, not just a fee.",
      },
      {
        key: "freelancer/advance-tax",
        title: "Advance tax instalment",
        category: "Taxes",
        recurrence: "Quarterly",
        leadOffsets: [WEEK, DAY],
        note: "Four instalments a year; underpaying them accrues interest quietly.",
      },
      {
        key: "freelancer/invoice-followup",
        title: "Chase unpaid invoices",
        category: "EMI / Loans",
        recurrence: "Monthly",
        on: { day: 1 },
        leadOffsets: [DAY],
      },
      {
        key: "freelancer/tds-certificate",
        title: "Collect TDS certificates",
        category: "Taxes",
        recurrence: "Quarterly",
        leadOffsets: [WEEK],
      },
      {
        key: "freelancer/professional-tax",
        title: "Professional tax",
        category: "Taxes",
        recurrence: "Yearly",
        leadOffsets: [WEEK, DAY],
        amount: 2500,
      },
    ],
  },
];

export function findPack(id: unknown): Pack | undefined {
  return PACKS.find((p) => p.id === id);
}

/**
 * Guards the lead offsets a pack asks for.
 *
 * The reminder form only offers a fixed set, and the dispatcher plans one alert per
 * entry — a stray value here would create an alert the UI can't show and the user can't
 * turn off. Cheap to check at the boundary, impossible to notice later.
 */
export function validLeadOffsets(offsets: number[]): number[] {
  return offsets.filter((o) => LEAD_OFFSET_VALUES.includes(o));
}

/** How far out an item with no calendar date lands, for the user to correct. */
const PLACEHOLDER_DAYS = 30;

export interface ResolvedDue {
  dueAt: Date;
  /**
   * True when the date is a stand-in rather than the item's real one. The preview says so
   * and the import still goes ahead — a reminder with a date you can fix beats one you
   * have to create from nothing.
   */
  placeholder: boolean;
}

/**
 * The next time this item is actually due, in the importer's own timezone.
 *
 * Resolved at import rather than stored in the pack, because "the 5th" is a different
 * instant for every user, and the reminder engine works in absolute instants. Anything
 * computed in UTC here would fire on the wrong day for half the day.
 */
export function resolveDueAt(
  item: PackItem,
  now: Date,
  timeZone: string,
  defaultTime: string,
): ResolvedDue {
  if (!item.on) {
    const d = new Date(now.getTime() + PLACEHOLDER_DAYS * 86_400_000);
    return { dueAt: atLocalTime(d, timeZone, defaultTime), placeholder: true };
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month] = parts.split("-").map(Number);

  if (item.on.month) {
    // A yearly date: this year if it hasn't passed, otherwise next.
    const thisYear = local(year, item.on.month, item.on.day, timeZone, defaultTime);
    return {
      dueAt:
        thisYear > now
          ? thisYear
          : local(year + 1, item.on.month, item.on.day, timeZone, defaultTime),
      placeholder: false,
    };
  }

  // A day of the month: this month if it hasn't passed, otherwise next. Date.UTC
  // normalises month 13, so December needs no special case.
  const thisMonth = local(year, month, item.on.day, timeZone, defaultTime);
  if (thisMonth > now) return { dueAt: thisMonth, placeholder: false };
  const rolled = new Date(Date.UTC(year, month, 1));
  return {
    dueAt: local(
      rolled.getUTCFullYear(),
      rolled.getUTCMonth() + 1,
      item.on.day,
      timeZone,
      defaultTime,
    ),
    placeholder: false,
  };
}

function local(
  year: number,
  month: number,
  day: number,
  timeZone: string,
  time: string,
): Date {
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return parseLocalDateTime(iso, time, timeZone);
}

function atLocalTime(instant: Date, timeZone: string, time: string): Date {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return parseLocalDateTime(iso, time, timeZone);
}
