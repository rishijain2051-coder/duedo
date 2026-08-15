// What the first-run walkthrough says, and which steps a given account gets.
//
// The copy lives here rather than inside the dialog for the same reason lib/date-text.ts
// is its own file: a smoke suite can then run the real filter and assert that a solo
// account is never walked through the family list, and that nobody is toured around a
// feature their plan doesn't include — which is the difference between a walkthrough
// and an advert. Import-free, so the suite can load it directly.

/** One line of a short list, where a list says it better than a sentence does. */
export interface IntroPoint {
  name: string;
  what: string;
}

export interface IntroStep {
  /** Stable. The dialog picks an icon from it, and the suite asserts on it. */
  id: string;
  title: string;
  body: string[];
  points?: IntroPoint[];
  /**
   * Hands over to a guided tour of this id (lib/tours.ts) when pressed.
   *
   * Only the closing step carries one. This dialog is the read; the tour is the doing,
   * and offering the doing halfway through the read would end the read.
   *
   * A bare string rather than an import, because this file stays import-free so a
   * suite can load it — which is also where the two are checked against each other.
   */
  startsTour?: string;
}

/**
 * Everything the steps need to know, already resolved.
 *
 * Entitlements arrive as plain booleans rather than a plan id, so this file never has
 * to hold a second copy of what each plan includes — lib/plan.ts stays the only place
 * that decides, and the tour cannot drift from it.
 */
export interface IntroContext {
  /** First name. "" is fine — the greeting drops it rather than saying "Welcome, ". */
  name: string;
  accountType: "solo" | "family";
  email: boolean;
  spending: boolean;
  voice: boolean;
  /** Nothing paid. Decides only whether the closing step mentions the plans at all. */
  free: boolean;
  /** This account's overdue repeat, so the escalation step states a true number. */
  overdueRepeatMins: number;
}

/** "every hour" reads better than "every 60 minutes", and is the common case. */
function repeatPhrase(mins: number): string {
  if (mins > 0 && mins % 60 === 0) {
    const hours = mins / 60;
    return hours === 1 ? "every hour" : `every ${hours} hours`;
  }
  return `every ${mins} minutes`;
}

export function introSteps(ctx: IntroContext): IntroStep[] {
  const first = ctx.name.trim().split(/\s+/)[0] ?? "";

  const steps: IntroStep[] = [
    {
      id: "welcome",
      title: first ? `Welcome, ${first}` : "Welcome to DueDo",
      body: [
        "DueDo holds the things you would rather not: bills, birthdays, renewals, the policy that lapses quietly in March.",
        "This is a quick walk through it. About a minute, and you can leave at any point — Skip is down there on the left.",
      ],
    },
    {
      id: "add",
      title: "A title and a date is the whole form",
      body: [
        "Everything else is optional: a time, a category, an amount, whether it repeats every month.",
        "Leave the time out and it takes the clock time you saved it at plus ten minutes, rather than some fixed hour you would have to remember choosing.",
      ],
    },
    {
      id: "escalate",
      title: "It does not ask only once",
      body: [
        "Under “If it’s still not done” you can stack nudges: another notification an hour later, one the next morning, one to somebody else entirely.",
        `And while a reminder is overdue it comes back ${repeatPhrase(ctx.overdueRepeatMins)} until it is done or snoozed. That gap is yours to change in Settings.`,
      ],
    },
    {
      id: "delivery",
      title: "Where the reminders actually arrive",
      body: [
        "Push notifications go to your lock screen. On an iPhone that only works once DueDo is on the Home Screen — Share, then Add to Home Screen, then open it from the new icon.",
        ctx.email
          ? "An email goes out as well, and either channel can be turned off in Settings."
          : "You can turn push off in Settings at any time.",
        "Nothing is ever only a notification: every one is kept under Notifications too, so a banner you swiped away is not a bill you missed.",
      ],
    },
    {
      id: "screens",
      title: "Where everything lives",
      body: [],
      points: [
        { name: "Dashboard", what: "what needs attention right now" },
        { name: "Reminders", what: "the full list, and where you add them" },
        { name: "Calendar", what: "the same reminders laid out as a month" },
        // No dash inside a `what`: the dialog already puts one between the two, and
        // "Categories — your own labels — Rent" reads as a stutter.
        { name: "Categories", what: "your own labels, such as Rent or Insurance" },
        ...(ctx.spending
          ? [{ name: "Spending", what: "what the amounts on them add up to" }]
          : []),
        { name: "Notifications", what: "everything that has been sent to you" },
      ],
    },
  ];

  if (ctx.accountType === "family") {
    steps.push({
      id: "family",
      title: "Your family’s list sits beside your own",
      body: [
        "The Mine / family switch at the top of Reminders and Spending chooses which one you are looking at. Your personal list stays personal.",
        "Assign a reminder to someone and the notification goes to them, not only to you. The join code in Settings is how the next person gets in.",
      ],
    });
  }

  if (ctx.voice) {
    steps.push({
      id: "voice",
      title: "Or say it instead of typing it",
      body: [
        "Settings has an Apple Shortcut to install: “Hey Siri, add reminder”, then say the thing out loud.",
        "It arrives here with the date already read out of the sentence — “electricity bill on the fourth” is a reminder on the fourth.",
      ],
    });
  }

  steps.push({
    id: "done",
    title: "That is the whole app",
    body: [
      ...(ctx.free
        ? [
            "Email reminders, spending and adding by voice come with the paid plans. Everything you have just seen works on Free.",
          ]
        : []),
      "You can run this again whenever you like — it is near the bottom of Settings.",
      "Two things you will not notice until you need them:",
    ],
    points: [
      {
        name: "It works offline",
        what: "anything you add or tick off is sent when the signal comes back",
      },
      {
        name: "Face ID instead of the PIN",
        what: "add a passkey in Settings and the PIN becomes the fallback",
      },
    ],
    // Straight into the guided tour rather than into the reminder form. The tour's
    // second stop is that form, with each field explained as it is reached — so this
    // is the same destination with somebody walking beside you.
    startsTour: "dashboard",
  });

  return steps;
}
