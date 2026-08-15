// The guided tours: one short one per page, pointing at the real controls.
//
// The intro dialog (lib/walkthrough.ts) says what the app is. These say how a screen
// works, standing on that screen, with the thing being described lit up. So the copy
// here is allowed to be specific in a way the dialog's cannot: it names buttons, and
// it uses real examples — an electricity bill on the 5th, ₹2,400 — rather than "your
// item" and "a value".
//
// Steps point at elements by `data-tour="…"`, never by class name or position. That is
// the whole reason this is safe to anchor at all: a class name is a styling decision
// that anybody may change, and a tour anchored to one keeps working right up until
// somebody does, then points at the wrong corner of the screen with nothing to say it
// is wrong. A data attribute is a contract, it is greppable, and the smoke suite reads
// this file and checks every anchor named here still exists in the page that owns it.
//
// Import-free so the suite can load it.

export interface TourStep {
  id: string;
  /**
   * The `data-tour` value to point at. Omitted means a card in the middle of the
   * screen, for a step that is about the page as a whole.
   */
  anchor?: string;
  title: string;
  body: string;
  /**
   * Wait for the highlighted control to actually be pressed, instead of offering
   * Next. Used where the step *is* the action — pressing New Reminder is what opens
   * the form the next four steps are about, so offering Next would walk somebody
   * into four skipped steps.
   *
   * The engine still shows Next if the element turns out to be disabled, so this can
   * never dead-end.
   */
  awaitClick?: boolean;
  /** Included only for an account that has this. */
  needs?: "family" | "spending" | "voice";
}

export interface Tour {
  id: string;
  /** The route it runs on. Starting it anywhere else navigates here first. */
  path: string;
  /** Named in the launcher, and in the "Next: …" that ends the tour before it. */
  label: string;
  /** One line under the label in the launcher. */
  blurb: string;
  /** What follows it in the full run. Absent ends the run. */
  next?: string;
  steps: TourStep[];
}

/** What a step can be gated on. Resolved before it reaches here. */
export interface TourContext {
  /**
   * Belongs to at least one family — not merely "chose the family account type".
   *
   * The two are different, and the difference is visible: the Mine/family switch is
   * built from the list of families you are in, so an account that ticked the box and
   * has not yet created or joined one renders nothing at all there. Gating on the
   * declared type put a spotlight around a nought-pixel-tall element.
   */
  family: boolean;
  spending: boolean;
  voice: boolean;
}

export const TOURS: Tour[] = [
  {
    id: "dashboard",
    path: "/dashboard",
    label: "Dashboard",
    blurb: "What the numbers mean, and what needs you now.",
    next: "reminders",
    steps: [
      {
        id: "kpis",
        anchor: "dash-kpis",
        title: "Four numbers, and one of them is not about you",
        body: "Active, due today, overdue, done this month. Overdue counts every list you can see — so on a family account it can be red while the line above says nothing is due for you. That is somebody else being late, not a bug.",
      },
      {
        id: "spend",
        anchor: "dash-spend",
        needs: "spending",
        title: "What you have paid this month",
        body: "Completing a reminder that carries an amount adds it here. An electricity bill ticked off at ₹2,400 lands in this tile and in Spending.",
      },
      {
        id: "upcoming",
        anchor: "dash-upcoming",
        title: "The next five, soonest first",
        body: "Not the whole list — the part you would want to see standing at the door with your keys in your hand.",
      },
      {
        id: "add",
        anchor: "dash-add",
        title: "And this is the short way in",
        body: "It opens the reminder form straight away, with today already filled in. The next tour walks through that form.",
      },
    ],
  },
  {
    id: "reminders",
    path: "/reminders",
    label: "Reminders",
    blurb: "Add one properly, with the nudges that chase it.",
    next: "calendar",
    // The two steps about the list come first, and that ordering is not cosmetic: the
    // form opens as a modal over this page, so anything pointed at afterwards would be
    // lit up behind a dark backdrop. The narrative is better this way round anyway —
    // here is the list, here is how you add to it, here is the form.
    steps: [
      {
        id: "scope",
        anchor: "rem-scope",
        needs: "family",
        title: "Mine, or the family's",
        body: "This switch decides which list you are looking at, and which list a new reminder is created on. Your personal one stays personal; anything on a family list is visible to everyone in it.",
      },
      {
        id: "filters",
        anchor: "rem-filters",
        title: "Active, snoozed, completed",
        body: "Nothing is deleted when it is done — it moves to Completed, which is where the spending figures are read from.",
      },
      {
        id: "new",
        anchor: "rem-new",
        awaitClick: true,
        title: "Press this and we will fill one in together",
        body: "Nothing is saved until you press Create at the end, so there is no harm in opening it to look.",
      },
      {
        id: "title",
        anchor: "form-title",
        title: "Name it the way you would say it out loud",
        body: "“Electricity bill”. Not “Utility payment reminder — August”. This is what you will read on a lock screen at half past seven in the morning, and the short one is the one you will recognise.",
      },
      {
        id: "date",
        anchor: "form-date",
        title: "The date is always dd/mm/yyyy",
        body: "05/09/2026 is the fifth of September, on every machine, whatever the browser's language is set to. Type over a wrong digit to fix it, or use the button beside it for a calendar.",
      },
      {
        id: "lead",
        anchor: "form-lead",
        title: "The nudges before it is due",
        body: "You always get one at the due time itself. These are the extra ones — a day before for a bill, a week before for an insurance renewal. Any that are already in the past for this date are struck out rather than quietly ignored.",
      },
      {
        id: "escalate",
        anchor: "form-escalate",
        title: "And what happens if you ignore all of that",
        body: "Up to two more: another notification hours later, to you, to whoever it is assigned to, or to an address outside the app. This is the part that separates a reminder from a note to self.",
      },
      {
        id: "save",
        anchor: "form-save",
        title: "Create saves it",
        body: "Close the form instead and nothing has happened — no half-made reminder, nothing sent, nothing to tidy up.",
      },
    ],
  },
  {
    id: "calendar",
    path: "/calendar",
    label: "Calendar",
    blurb: "The same reminders, laid out as a month.",
    next: "categories",
    steps: [
      {
        id: "grid",
        anchor: "cal-grid",
        title: "Every list you can see, on one grid",
        body: "A dot per reminder, coloured by its category — so a month with four blue dots in one week is four bills in one week. Tap a day to read what is on it.",
      },
      {
        id: "nav",
        anchor: "cal-nav",
        title: "Move about, then come back",
        body: "Arrows for the month either side, and Today to land back on the current one however far you have wandered.",
      },
    ],
  },
  {
    id: "categories",
    path: "/categories",
    label: "Categories",
    blurb: "Your own labels, and the colours they carry.",
    next: "insights",
    steps: [
      {
        id: "new",
        anchor: "cat-new",
        title: "Rent, School, Insurance — your words",
        body: "Every reminder belongs to one, which is what lets Spending answer “how much on school this year” without you tagging anything twice.",
      },
      {
        id: "list",
        anchor: "cat-list",
        title: "The colour is not decoration",
        body: "It is the dot on the calendar and the chip on the list. Give the ones you check often colours you can tell apart at a glance.",
      },
    ],
  },
  {
    id: "insights",
    path: "/insights",
    label: "Spending",
    blurb: "What the amounts add up to.",
    next: "notifications",
    steps: [
      {
        id: "month",
        anchor: "spend-month",
        title: "This month, as it stands",
        body: "Built from reminders you have completed, so it is what you have actually paid rather than what you have planned to.",
      },
      {
        id: "categories",
        anchor: "spend-categories",
        title: "And where it went",
        body: "Each category against its own three-month average, so “₹8,000 on school” comes with the fact that it is usually ₹3,000.",
      },
    ],
  },
  {
    id: "notifications",
    path: "/notifications",
    label: "Notifications",
    blurb: "Everything that has been sent to you.",
    next: "settings",
    steps: [
      {
        id: "list",
        anchor: "notif-list",
        title: "Nothing is ever only a banner",
        body: "Every notification the app sends is kept here too. A phone on silent, a banner swiped away by accident, a week away from your desk — none of them lose you a bill.",
      },
      {
        id: "unread",
        anchor: "notif-unread",
        title: "And the badge comes from this page",
        body: "The count on the app icon and in the sidebar is how many of these are unread.",
      },
    ],
  },
  {
    id: "settings",
    path: "/settings",
    label: "Settings",
    blurb: "How you are reached, and how you get in.",
    steps: [
      {
        id: "account",
        anchor: "set-account",
        title: "Start with the timezone",
        body: "Every date in the app is drawn in this zone, and the dispatcher sends by it. Set it to where you actually are and “tomorrow at 9” means what you think it means.",
      },
      {
        id: "channels",
        anchor: "set-channels",
        title: "How a reminder reaches you",
        body: "Push to the lock screen, email, or both. There is a Send test button for each — use it now rather than finding out on the day a bill is due.",
      },
      {
        id: "siri",
        anchor: "set-siri",
        needs: "voice",
        title: "Adding one without typing",
        body: "Install the Apple Shortcut here and “Hey Siri, add reminder” takes it by voice: say “electricity bill on the fifth” and it arrives with the date already read out of the sentence.",
      },
      {
        id: "security",
        anchor: "set-security",
        title: "Face ID instead of the PIN",
        body: "Add a passkey and this device signs in with your face or fingerprint. The PIN stays as the fallback, so a lost passkey never locks you out.",
      },
      {
        id: "walkthrough",
        anchor: "set-walkthrough",
        title: "And this is where the tours live",
        body: "Any of them again, any time. That is the end of this one.",
      },
    ],
  },
];

/** The first tour of the full run. */
export const FIRST_TOUR = "dashboard";

export function tourById(id: string | null | undefined): Tour | undefined {
  return TOURS.find((t) => t.id === id);
}

/**
 * The tour belonging to a route, for the help button in the header.
 *
 * Exact match rather than a prefix: /settings and /settings/anything are the same
 * page here, but a prefix match would also hand /admin's tour to /admin/health.
 */
export function tourForPath(path: string): Tour | undefined {
  return TOURS.find((t) => t.path === path);
}

/** The steps this account gets, in order. */
export function stepsFor(tour: Tour, ctx: TourContext): TourStep[] {
  return tour.steps.filter((s) => {
    if (!s.needs) return true;
    return ctx[s.needs];
  });
}

/**
 * Every anchor named by any tour, for the assertion that they all still exist.
 *
 * Paired with the page that owns it, because "this anchor is somewhere in the repo"
 * is not the check worth making — a tour on /calendar pointing at an anchor that only
 * exists on /settings is exactly the failure this is meant to catch.
 */
export function anchorsByPath(): { path: string; anchors: string[] }[] {
  return TOURS.map((t) => ({
    path: t.path,
    anchors: t.steps.map((s) => s.anchor).filter((a): a is string => Boolean(a)),
  }));
}
