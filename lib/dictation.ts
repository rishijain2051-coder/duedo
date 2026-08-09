// Turning a spoken sentence into a reminder.
//
// Written for Apple Shortcuts: "Hey Siri, add reminder" → Dictate Text → POST here.
// Dictation gives one flat string with no punctuation to speak of, so everything the
// form asks for has to be recovered from wording.
//
// No imports, deliberately — the same rule lib/sync.ts follows. Every interesting part
// of this is a judgement about ambiguous English, and a judgement that can only be
// exercised by talking at a phone is a judgement that never gets tested. Free of
// prisma, React and Date-zone helpers, it runs under plain Node and
// scripts/smoke-dictation.mjs drives the real file rather than a paraphrase.
//
// The governing rule: **only fill in what was actually said.** A reminder on the wrong
// day is worse than a reminder with no date, because the wrong day looks handled. So
// every pattern below is anchored to an explicit word — no inference from context, no
// guessing at intent. Anything not recognised stays in the title, where the person can
// see it and fix it.

export interface DictationCategory {
  id: string;
  name: string;
}

export interface DictationInput {
  text: string;
  /** The instant "today" is measured from. */
  now: Date;
  /** The speaker's zone; every date word is resolved in it. */
  timeZone: string;
  /** HH:mm, used when a day was named but no time was. */
  defaultTime: string;
  /** The scope's categories, matched by name when one is named aloud. */
  categories?: DictationCategory[];
}

export interface DictationResult {
  title: string;
  /** Wall-clock text for parseDueAt: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm". */
  dueAt: string;
  categoryId?: string;
  amount?: number;
  recurrenceRule?: string;
  priority?: string;
  description?: string;
  /**
   * Each thing actually recognised, phrased for reading back aloud. The Shortcut
   * speaks this, which is the only feedback there is when the screen stays dark.
   */
  understood: string[];
  /** True when no date word was found and today was assumed. */
  dateAssumed: boolean;
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const WEEKDAYS = [
  "sunday", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday",
];

/** The current wall clock in `timeZone`, as plain numbers. */
function todayIn(
  now: Date,
  timeZone: string,
): { y: number; m: number; d: number; weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const shortDays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    weekday: shortDays.indexOf(get("weekday").toLowerCase().slice(0, 3)),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Adds days to a y/m/d triple without touching timezones. */
function addDays(y: number, m: number, d: number, n: number) {
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function addMonths(y: number, m: number, d: number, n: number) {
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return { y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) };
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (p: { y: number; m: number; d: number }) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;

/**
 * Removes the first match and reports what it was.
 *
 * Every rule consumes the words it used, so the title is whatever nobody claimed. That
 * is what stops "pay rent on the 5th" becoming a reminder titled "pay rent on the 5th"
 * that is also dated the 5th.
 */
function take(text: string, re: RegExp): { text: string; match: RegExpMatchArray | null } {
  const match = text.match(re);
  if (!match) return { text, match: null };
  return { text: text.replace(match[0], " "), match };
}

/** 12-hour clock plus an am/pm to "HH:mm". */
function to24(hour: number, minute: number, meridiem?: string): string {
  let h = hour;
  if (meridiem === "pm" && h < 12) h += 12;
  if (meridiem === "am" && h === 12) h = 0;
  return `${pad(h)}:${pad(minute)}`;
}

export function parseDictation(input: DictationInput): DictationResult {
  const understood: string[] = [];
  const today = todayIn(input.now, input.timeZone);
  // Sentence punctuation goes, but a comma or dot *inside a number* has to survive:
  // stripping them wholesale turned "₹18,500.50" into "18 500 50", and the amount rule
  // then read the last fragment as fifty rupees.
  let rest = ` ${input.text
    .toLowerCase()
    .replace(/[!?;]+/g, " ")
    .replace(/(\d)\s*,\s*(\d)/g, "$1,$2")
    .replace(/,(?!\d)/g, " ")
    .replace(/\.(?!\d)/g, " ")} `;

  // ------------------------------------------------------------------ lead-in
  // "Remind me to pay rent" is a sentence about the app, not about rent.
  rest = rest.replace(
    // "a new" as well as "a" and "new" — spoken openings vary, and a partial match
    // leaves the unmatched half sitting at the front of the title ("Hey add a …").
    /\b(?:hey |ok |please )*(?:remind me (?:to|that|about)|(?:add|create|set|make) (?:a |an )?(?:new )?reminder (?:to|for|about|that)|new reminder (?:to|for|about))\b/,
    " ",
  );

  // --------------------------------------------------------------- recurrence
  // Anchored on "every"/"each" or an explicit adverb. Without that anchor, "the end
  // of the month" is a date somebody named, not a schedule they asked for — and
  // turning a one-off into a repeating charge is the kind of wrong that keeps firing.
  let recurrenceRule: string | undefined;
  const RECUR: [RegExp, string, string][] = [
    [/\b(?:at the )?end of (?:the |every |each )?month(?:ly)?\b(?=.*\b(?:every|each)\b)|\b(?:every|each) month end\b|\bend of (?:every|each) month\b/, "End of the month", "at the end of every month"],
    [/\b(?:beginning|start) of (?:every|each) month\b|\b(?:every|each) month (?:beginning|start)\b|\b(?:on the )?(?:1st|first) of (?:every|each) month\b/, "Beginning of the month", "at the start of every month"],
    [/\b(?:every|each) day\b|\bdaily\b/, "Daily", "every day"],
    [/\b(?:every|each) week\b|\bweekly\b/, "Weekly", "every week"],
    [/\b(?:every|each) (?:3|three) months\b|\bquarterly\b/, "Quarterly", "every three months"],
    [/\b(?:every|each) (?:6|six) months\b|\bhalf[- ]yearly\b/, "Half-Yearly", "every six months"],
    [/\b(?:every|each) (?:year|12 months)\b|\byearly\b|\bannually\b/, "Yearly", "every year"],
    [/\b(?:every|each) month\b|\bmonthly\b/, "Monthly", "every month"],
  ];
  for (const [re, rule, said] of RECUR) {
    const r = take(rest, re);
    if (r.match) {
      rest = r.text;
      recurrenceRule = rule;
      understood.push(said);
      break;
    }
  }

  // ------------------------------------------------------------------- amount
  let amount: number | undefined;
  const AMOUNT: RegExp[] = [
    /₹\s?([\d,]+(?:\.\d{1,2})?)/,
    /\b(?:rs\.?|rupees?|inr)\s*([\d,]+(?:\.\d{1,2})?)/,
    /\b([\d,]+(?:\.\d{1,2})?)\s*(?:rs\b|rupees?\b|bucks\b)/,
  ];
  for (const re of AMOUNT) {
    const r = take(rest, re);
    if (r.match) {
      const n = Number(r.match[1].replace(/,/g, ""));
      if (Number.isFinite(n)) {
        rest = r.text;
        amount = n;
        understood.push(`₹${n.toLocaleString("en-IN")}`);
      }
      break;
    }
  }

  // ----------------------------------------------------------------- priority
  let priority: string | undefined;
  const high = take(rest, /\b(?:high priority|urgent|important)\b/);
  if (high.match) {
    rest = high.text;
    priority = "high";
    understood.push("high priority");
  } else {
    const low = take(rest, /\blow priority\b/);
    if (low.match) {
      rest = low.text;
      priority = "low";
      understood.push("low priority");
    }
  }

  // --------------------------------------------------------------------- time
  let time: string | undefined;
  let timeSaid: string | undefined;

  const clock = take(rest, /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (clock.match) {
    rest = clock.text;
    time = to24(Number(clock.match[1]), Number(clock.match[2] ?? 0), clock.match[3]);
    timeSaid = time;
  } else {
    const military = take(rest, /\bat\s+(\d{1,2}):(\d{2})\b/);
    if (military.match) {
      rest = military.text;
      time = to24(Number(military.match[1]), Number(military.match[2]));
      timeSaid = time;
    } else {
      // Named times. noon and midnight are exact; the four vague ones are stated
      // approximations — documented here and read back aloud, so a wrong guess is
      // one the speaker hears rather than one that only shows up when it fires.
      const NAMED: [RegExp, string][] = [
        [/\bnoon\b|\bmidday\b/, "12:00"],
        [/\bmidnight\b/, "00:00"],
        [/\b(?:in the )?morning\b/, "09:00"],
        [/\b(?:in the )?afternoon\b/, "15:00"],
        [/\b(?:in the )?evening\b|\btonight\b/, "18:00"],
        [/\b(?:at )?night\b/, "21:00"],
      ];
      for (const [re, at] of NAMED) {
        const r = take(rest, re);
        if (r.match) {
          rest = r.text;
          time = at;
          timeSaid = at;
          break;
        }
      }
    }
  }

  // --------------------------------------------------------------------- date
  let date: { y: number; m: number; d: number } | undefined;
  let dateSaid: string | undefined;

  const setDate = (p: { y: number; m: number; d: number }, said: string) => {
    date = p;
    dateSaid = said;
  };

  const dayAfter = take(rest, /\bday after tomorrow\b/);
  if (dayAfter.match) {
    rest = dayAfter.text;
    setDate(addDays(today.y, today.m, today.d, 2), "the day after tomorrow");
  }

  if (!date) {
    const tomorrow = take(rest, /\btomorrow\b/);
    if (tomorrow.match) {
      rest = tomorrow.text;
      setDate(addDays(today.y, today.m, today.d, 1), "tomorrow");
    }
  }

  if (!date) {
    const t = take(rest, /\btoday\b/);
    if (t.match) {
      rest = t.text;
      setDate(today, "today");
    }
  }

  if (!date) {
    // "in 5 minutes", "in two hours", "in half an hour", "in 3 days", "in a month".
    //
    // Minutes and hours are the ones people actually say to a phone — "remind me to
    // take the pasta off in ten minutes" — and they set the *time* as well as the day,
    // which is why this sits here rather than with the other date rules. Left out
    // originally, they were not recognised at all: the words stayed in the title and
    // the reminder quietly landed at today's default time, which is no reminder.
    const rel = take(
      rest,
      /\bin\s+(half an|a|an|\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty[- ]?five|sixty|ninety)\s+(min|minute|hour|hr|day|week|month|year)s?\b/,
    );
    if (rel.match) {
      const words: Record<string, number> = {
        a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
        six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
        fifteen: 15, twenty: 20, thirty: 30, "forty-five": 45, "forty five": 45,
        sixty: 60, ninety: 90,
      };
      const raw = rel.match[1];
      const unit = rel.match[2].replace(/^min$/, "minute").replace(/^hr$/, "hour");
      // "half an hour" is 30 minutes, not half of one.
      const half = raw === "half an";
      const n = half ? 0.5 : (words[raw] ?? Number(raw));
      if (Number.isFinite(n)) {
        rest = rel.text;
        if (unit === "minute" || unit === "hour") {
          const added = Math.round(unit === "hour" ? n * 60 : n);
          const total = today.hour * 60 + today.minute + added;
          const p = addDays(today.y, today.m, today.d, Math.floor(total / 1440));
          const mins = ((total % 1440) + 1440) % 1440;
          time = `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
          timeSaid = time;
          setDate(p, half ? "in half an hour" : `in ${n} ${unit}${n === 1 ? "" : "s"}`);
        } else {
          const p =
            unit === "day" ? addDays(today.y, today.m, today.d, n)
            : unit === "week" ? addDays(today.y, today.m, today.d, n * 7)
            : unit === "month" ? addMonths(today.y, today.m, today.d, n)
            : addMonths(today.y, today.m, today.d, n * 12);
          setDate(p, `in ${n} ${unit}${n === 1 ? "" : "s"}`);
        }
      }
    }
  }

  if (!date) {
    const endMonth = take(rest, /\b(?:at the )?end of (?:the |this )?month\b/);
    if (endMonth.match) {
      rest = endMonth.text;
      setDate({ y: today.y, m: today.m, d: daysInMonth(today.y, today.m) }, "the end of this month");
    }
  }

  if (!date) {
    const startMonth = take(rest, /\b(?:beginning|start) of (?:the )?next month\b|\b(?:1st|first) of next month\b/);
    if (startMonth.match) {
      rest = startMonth.text;
      const n = addMonths(today.y, today.m, 1, 1);
      setDate({ y: n.y, m: n.m, d: 1 }, "the 1st of next month");
    }
  }

  if (!date) {
    // "next monday", "on friday" — the next such weekday strictly after today.
    const wd = take(rest, new RegExp(`\\b(?:on |next |this )?(${WEEKDAYS.join("|")})\\b`));
    if (wd.match) {
      rest = wd.text;
      const target = WEEKDAYS.indexOf(wd.match[1]);
      let delta = (target - today.weekday + 7) % 7;
      if (delta === 0) delta = 7; // "on monday" said on a Monday means the next one
      setDate(addDays(today.y, today.m, today.d, delta), `next ${wd.match[1]}`);
    }
  }

  if (!date) {
    // "15 August", "August 15", "15th of August" — year optional.
    const monthNames = MONTHS.join("|");
    const dm = take(rest, new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})\\b(?:\\s+(\\d{4}))?`));
    const md = dm.match
      ? null
      : take(rest, new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+(\\d{4}))?`));
    const hit = dm.match ? { text: dm.text, day: Number(dm.match[1]), month: MONTHS.indexOf(dm.match[2]) + 1, year: dm.match[3] }
      : md?.match ? { text: md.text, day: Number(md.match[2]), month: MONTHS.indexOf(md.match[1]) + 1, year: md.match[3] }
      : null;
    if (hit && hit.day >= 1 && hit.day <= 31) {
      rest = hit.text;
      // No year given: this year, unless that date has already gone, which means the
      // one being named is next year's.
      let y = hit.year ? Number(hit.year) : today.y;
      if (!hit.year && (hit.month < today.m || (hit.month === today.m && hit.day < today.d))) y += 1;
      const d = Math.min(hit.day, daysInMonth(y, hit.month));
      // Capitalised for the readback — the whole sentence was lowercased to parse it,
      // and "15 september" spoken back sounds like a transcription error.
      const monthName = MONTHS[hit.month - 1];
      setDate({ y, m: hit.month, d }, `${d} ${monthName[0].toUpperCase()}${monthName.slice(1)} ${y}`);
    }
  }

  if (!date) {
    // "15/8" or "15/8/2026" — day first, as written here.
    const slash = take(rest, /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (slash.match) {
      const d = Number(slash.match[1]);
      const m = Number(slash.match[2]);
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        rest = slash.text;
        let y = slash.match[3] ? Number(slash.match[3]) : today.y;
        if (y < 100) y += 2000;
        if (!slash.match[3] && (m < today.m || (m === today.m && d < today.d))) y += 1;
        setDate({ y, m, d: Math.min(d, daysInMonth(y, m)) }, `${d}/${m}/${y}`);
      }
    }
  }

  if (!date) {
    // "on the 15th" — this month if it is still ahead, otherwise next month.
    const dom = take(rest, /\bon the (\d{1,2})(?:st|nd|rd|th)\b/);
    if (dom.match) {
      const d = Number(dom.match[1]);
      if (d >= 1 && d <= 31) {
        rest = dom.text;
        const thisMonth = d >= today.d;
        const base = thisMonth ? { y: today.y, m: today.m } : addMonths(today.y, today.m, 1, 1);
        const y = base.y;
        const m = base.m;
        setDate({ y, m, d: Math.min(d, daysInMonth(y, m)) }, `the ${d}${thisMonth ? "" : " of next month"}`);
      }
    }
  }

  const dateAssumed = !date;
  const resolved = date ?? today;

  // ----------------------------------------------------------------- category
  let categoryId: string | undefined;
  const categories = input.categories ?? [];
  if (categories.length > 0) {
    for (const c of categories) {
      const name = c.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Only when the category is *named as one*. A bare mention is how "pay the
      // vehicle insurance" ends up filed under Vehicle when the speaker meant
      // Insurance — matching on a preposition keeps it to what was actually asked.
      const r = take(rest, new RegExp(`\\b(?:under|in the|category)\\s+${name}\\b(?:\\s+category)?|\\b${name}\\s+category\\b`));
      if (r.match) {
        rest = r.text;
        categoryId = c.id;
        understood.push(`filed under ${c.name}`);
        break;
      }
    }
  }

  // -------------------------------------------------------------------- notes
  let description: string | undefined;
  const note = take(rest, /\bnotes?\s+(?:that\s+|:\s*)?(.+)$/);
  if (note.match) {
    rest = note.text;
    const body = note.match[1].trim();
    if (body) {
      description = body.charAt(0).toUpperCase() + body.slice(1);
      understood.push("a note");
    }
  }

  // -------------------------------------------------------------------- title
  // Whatever no rule claimed. Dangling prepositions are the residue of a date or
  // amount being lifted out of the middle of the sentence ("pay rent on" once "the
  // 5th" has gone), so they are trimmed rather than left looking like a typo.
  // The `+` matters: lifting "end of every month" out of "pay rent at the end of every
  // month" leaves *two* dangling words, and stripping one per pass left "Pay rent at".
  let title = rest
    .replace(/\s+/g, " ")
    .replace(/(?:\s*\b(?:on|at|by|for|of|in|the|a|an|to|and)\b)+\s*$/i, "")
    .replace(/^(?:\s*\b(?:on|at|by|for|of|in|and|the)\b)+\s*/i, "")
    .trim();
  if (title) title = title.charAt(0).toUpperCase() + title.slice(1);

  const dueAt = time ? `${iso(resolved)}T${time}` : iso(resolved);

  // Read back in the order a person would say it.
  const spokenDate = dateSaid ?? "today";
  understood.unshift(timeSaid ? `${spokenDate} at ${timeSaid}` : spokenDate);

  return {
    title,
    dueAt,
    categoryId,
    amount,
    recurrenceRule,
    priority,
    description,
    understood,
    dateAssumed,
  };
}
