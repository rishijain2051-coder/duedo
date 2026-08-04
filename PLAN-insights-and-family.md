# Plan — spending awareness, family accountability, offline

Agreed 4 August 2026. Three phases. Everything in the brief is in scope.

**Framing, corrected:** this is not a finance feature. It answers "what's due and roughly
what have I been spending", and stops there. No tax framing, no financial year, no PDF
export, no accounting semantics. That decision removed about a third of the earlier draft
rather than renaming it — the year basis question, the print stylesheet, the frozen
category labels and a second rollup table all existed only to serve filing.

No paid tier: build unlimited.

---

## Decisions carried in

| Question | Answer |
| --- | --- |
| Deleting a reminder deletes its payment history | **Accepted.** `onDelete: Cascade` stays. One consequence to keep honest: the CSV states it covers reminders currently in the app, so a total that looks short has a visible reason. |
| "Was it done on time?" | **Wanted.** Needs `cycleDueAt` on history — see phase 1. |
| Monthly data feeding a yearly view | **Yes**, via one rollup table written at month close. |
| Detail retention | **Keep 3 months, then prune** what has been rolled up. |
| Streaks | **Both** weekly and monthly. |
| Assign from a notification | **One tap to the picker**, not one tap to assign. |
| Gamification off by default | Member ranking, streak badges, nudge prompts. The monthly report card to the head stays **on**. |
| Year basis, PDF export | **Dropped.** Calendar months and years, CSV only. |

### Two interactions worth stating before they surprise anyone

**Weekly streaks outlive the data they're computed from.** Pruning at 3 months caps a
computed weekly streak at ~13 weeks. So streaks are not computed from history at all —
they are **counters advanced once at each week and month close** and stored on
`FamilyMember`. Four integers, no history dependency, and they survive pruning intact.
This is also simpler than the query it replaces.

**The report card can't contain what you switched off.** Ranking and streaks are off by
default but the head's monthly email is on, so by default that email carries per-member
assigned / completed / on-time counts and nothing else — no ordering, no streaks. Turning
those on adds them to the email too. Otherwise the one thing that arrives unasked would
be the one thing containing what you chose to hide.

---

## Phase 1 — spending awareness

Almost entirely a read over data you already store. One new column, one new table, one
new page.

### Schema

```prisma
model ReminderHistory {
  // ... unchanged, including onDelete: Cascade
  /// The due instant THIS completion settled. Recurrence advances Reminder.dueAt, so
  /// without this there is no way afterwards to ask whether it was done on time.
  cycleDueAt DateTime? @db.Timestamptz

  @@index([completedOn])
}

/// One month, closed and totalled. Exists so the yearly view survives pruning — it is
/// the only record of anything older than three months.
model MonthlyRollup {
  id String @id @default(uuid())

  /// "u:<userId>" for a personal total, "f:<familyId>" for a shared list. A single
  /// string rather than two nullable columns because Postgres does not treat NULLs as
  /// equal in a unique index, so (userId, familyId, month) would happily go duplicate.
  scopeKey    String
  /// First instant of the month in the owner's timezone, stored UTC.
  month       DateTime @db.Timestamptz
  /// Category id, or "none" — same NULL-in-unique-index reason as above.
  categoryKey String
  /// Frozen here, so renaming a category later doesn't relabel a closed month.
  categoryName String

  spent       Float @default(0)
  completions Int   @default(0)

  @@unique([scopeKey, month, categoryKey])
  @@index([scopeKey, month])
}
```

**Backfill:** `cycleDueAt` on existing rows would have to come from the reminder's current
`dueAt`, which is wrong for anything already rolled forward. Leave existing rows null and
have on-time statistics start from the migration date. An honest start line beats a streak
that quietly counts guesses.

### Month close and pruning

`lib/rollup.ts`, called from the same daily tick that already runs the audit rotation —
that tick is the one thing guaranteed to fire, and a second cron job would be a second
thing that can silently stop.

Once a day, per account and per family, in that account's own timezone: if last month has
closed and has no rollup rows, write them from `ReminderHistory`. Idempotent through the
unique key.

Pruning follows the audit rotation's rule, for the same reason it was needed there:

- Only months that **already have rollup rows** are eligible.
- Only rows older than **3 whole months**.
- The delete is by explicit id list, never a bare range.
- A month with no rollup is never pruned, whatever its age — if the rollup failed, the
  detail is the only copy left.

### Routes

| Route | Returns |
| --- | --- |
| `GET /api/insights?scope=&month=` | This month's total, per-category breakdown, per-category trend, next-7-days forecast |
| `GET /api/insights/year?scope=&year=` | 12 months from `MonthlyRollup`, plus the current month computed live |
| `GET /api/insights/export?scope=&from=&to=` | `text/csv`, one row per completion, within retained detail |

All three read `ReminderHistory`/`MonthlyRollup`, **not** `Reminder`, so they bypass
`lib/ownership.ts` entirely. That makes scoping the security surface of this phase: a new
helper in `lib/reminder-scope.ts` (`historyScopeWhere(userId, scope)`) and its own
isolation assertions.

**Trend, defined once so it can't drift:** this calendar month against the mean of the
three complete months before it. Fewer than two complete months → no trend shown, rather
than a percentage with no denominator anyone would recognise.

### Code

- `lib/money.ts` — `round2()`, `formatINR()`, `sumAmounts()`. One place deciding how money
  rounds, so the page, the CSV and the push copy can't disagree. (`Float` stays; the error
  at household magnitudes is ~1e-6 rupees. The only real risk is `45200.000000001`
  reaching a download, which rounding fixes.)
- `lib/csv.ts` — `csvCell()` and `toCsv()` lifted out of `lib/audit-rotate.ts`, which then
  imports them.
- `app/api/reminders/[id]/complete/route.ts` — stamp `cycleDueAt`.
- `components/app-context.tsx` — `scope` + `setScope()`, persisted under the existing
  cache-owner key so it clears on account switch.

### UI

`app/insights/page.tsx` + a sidebar entry. Month total, category bars, a 6-month
sparkline per category, "due in the next 7 days" with the reminders behind it, a year
view, and a Download CSV button. **Hand-rolled SVG, no charting dependency** — recharts
is ~100 kB against a 103 kB shared bundle, and a bar chart plus a sparkline are about 80
lines each.

### Tests — `scripts/smoke-insights.mjs`

Totals match a hand-computed fixture. A second user's completions never appear. A family
member sees family totals but not another member's personal spend. The CSV round-trips
through a parser. A category with one month of data reports no trend. Rollup is idempotent
across two runs. **And the prune refuses a month whose rollup is missing** — that is the
assertion that matters, and it is written before the prune is.

**Risk:** low-medium. Read-only apart from the rollup, and the one destructive path is
guarded and tested first.

---

## Phase 2 — family: packs, switcher, accountability, escalation

Everything that makes a shared list feel shared. Largest phase by surface; every item is
additive and independently revertable.

### Schema

```prisma
model Reminder {
  // ...
  /// "I'll handle it". Cleared on completion and on recurrence roll. One per cycle: it
  /// answers "has anyone seen this?", not "who all saw it".
  acknowledgedAt   DateTime? @db.Timestamptz
  acknowledgedById String?

  /// Escalation steps. Json rather than a table: per-reminder, never queried by content.
  /// [{ afterMins, notify: "assignee"|"head"|"admins"|"external", contactId? }]
  escalation Json?

  /// Which pack an imported reminder came from, so a second import is a no-op.
  templateKey String?
}

model Family {
  // ... head-controlled, defaults chosen above
  showRanking         Boolean @default(false)
  showStreaks         Boolean @default(false)
  allowNudges         Boolean @default(false)
  monthlyReportToHead Boolean @default(true)
}

model FamilyMember {
  // ... streak counters, advanced at week and month close. Stored rather than computed
  // so they survive the 3-month prune, and cheaper than the query they replace.
  streakWeeks      Int       @default(0)
  bestStreakWeeks  Int       @default(0)
  streakMonths     Int       @default(0)
  bestStreakMonths Int       @default(0)
  streakCheckedAt  DateTime? @db.Timestamptz
}

/// One level deep. A reply to a reply is a conversation that belongs in a chat app.
model ReminderComment {
  id         String   @id @default(uuid())
  reminderId String
  reminder   Reminder @relation(fields: [reminderId], references: [id], onDelete: Cascade)
  authorId   String?
  author     User?    @relation(fields: [authorId], references: [id], onDelete: SetNull)
  body       String
  createdAt  DateTime @default(now()) @db.Timestamptz

  @@index([reminderId, createdAt])
}

/// Someone outside the app who can be escalated to, once they have agreed to it.
model ExternalContact {
  id          String    @id @default(uuid())
  ownerId     String
  owner       User      @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  email       String
  label       String?
  confirmedAt DateTime? @db.Timestamptz
  tokenHash   String?                        // HMAC over AUTH_SECRET, never the token
  tokenSentAt DateTime? @db.Timestamptz
  blockedAt   DateTime? @db.Timestamptz

  @@unique([ownerId, email])
}
```

### 2a — template packs and the switcher

Lowest risk, and it's what makes a brand-new account useful in one tap.

Packs are **data, not rows** — `lib/template-packs.ts` exports four: Indian Household
(LIC premium, vehicle insurance, Fastag, society maintenance, gas cylinder, passport),
Homeowner, Family Life, Freelancer. Each item carries a title, category name, recurrence,
the month/day it lands on, lead offsets, and an amount *hint*.

`POST /api/templates/import` — one transaction: ensure categories, create reminders with
`templateKey`, skip keys already present, return created and skipped counts.

**Preview then confirm, not a blind import.** Twelve reminders appearing unannounced is
indistinguishable from a bug; a checklist with resolved dates the user can untick is the
same feature with the surprise removed.

**Switcher:** the tab strip at [`app/reminders/page.tsx:72`](app/reminders/page.tsx)
already works — `FamilyMember` has been a join table from the start, so multi-family works
end to end in the API today. What's missing is that the scope is local to that page, so it
resets on navigation. Phase 1 lifts it into context; here it gets applied to the dashboard,
calendar, categories and insights, and shown whenever `families.length > 0` rather than
gated on `accountType`.

### 2b — accountability

**Routes**

- `POST /api/reminders/[id]/acknowledge` — recipients only, audited
- `GET|POST /api/reminders/[id]/comments`, `DELETE .../comments/[cid]` (author or head)
- `GET /api/family/[id]/activity` — merged feed from `ReminderHistory` + `ReminderComment`, paginated
- `GET /api/family/[id]/scoreboard?month=` — per member, honouring the family's flags
- `POST /api/reminders/[id]/nudge` — only when `allowNudges`

**Statistics, defined explicitly** — these are the numbers people will argue about:

- *Assigned* — family reminders with `audience = "assignee"` and `assignedToId = them`, whose cycle fell in the period
- *Completed* — a history row for that cycle, whoever filed it
- *On time* — `completedOn <= cycleDueAt`
- *Streak* — consecutive weeks (and months) with no missed assigned cycle. **A period with nothing assigned continues a streak rather than breaking it** — the alternative punishes people for a quiet week.

**Assign from a notification.** Push action buttons are fixed when the notification is
*sent*, and iOS shows at most two, so no picker can live inside one. The push gains an
**Assign** action that deep-links to the reminder with the picker already open; long-press
and desktop right-click open the same picker in-app. Reassigning notifies the new assignee
immediately and does not re-fire alerts already sent — the dedupe key includes `userId`, so
a new recipient gets the current cycle once and no back-fill.

**Given up, knowingly:** per-member stats for months beyond the 3-month detail window.
The yearly view carries spending, not per-person history. Adding it would mean a second
rollup table, which is exactly the complication we're avoiding — and nobody asked to see
who did what last September.

### 2c — escalation chains

Smallest feature, deepest change: it modifies `planFires()` in
[`lib/dispatch.ts`](lib/dispatch.ts), the one file where a bug means silence rather than an
error. **Ships behind a per-reminder opt-in, so a reminder with no `escalation` takes
byte-identical paths to today.**

A new `AlertKind` of `"escalation"` with `offsetMin = step.afterMins`. The existing dedupe
key `(reminderId, userId, cycleDueAt, kind, offsetMin)` already makes each step fire once
per cycle per recipient — the generalisation is free, which is a good sign the original key
was right.

Three guards, none obvious:

- **Acknowledgment stops the chain.** Someone saying "I'll handle it" is the whole signal escalation exists to wait for.
- **Escalations respect `OVERDUE_NAG_LIMIT_DAYS`.** A chain outliving the nagging it escalates would go quiet to the assignee while still mailing the landlord.
- **A step resolving to someone an earlier step already reached is skipped**, so a one-member family doesn't get the same alert three times under three names.

**External contacts.** First escalation to an unconfirmed address sends one "Rishi wants to
send you reminders about X — Confirm / Never" mail and nothing further. Confirm sets
`confirmedAt`; Never sets `blockedAt` permanently, and a blocked address can't be
re-invited by anyone. Single-use expiring tokens, same construction as
[`lib/verify-email.ts`](lib/verify-email.ts). `lib/mail.ts`'s reserved-domain guard covers
`.invalid`/`example.com` for free.

**Why the confirmation is load-bearing, not politeness:** all reminder mail leaves through
one Gmail account. Enough unconfirmed mail to strangers and Google throttles it — taking
out every reminder for every user, not just escalations. The consent step protects the
delivery channel the whole app runs on.

### Tests

`scripts/smoke-accountability.mjs` — a non-recipient can't acknowledge; a non-member can't
read the feed or comment; acknowledgment clears on completion and on recurrence roll;
on-time counts use `cycleDueAt` and stay right across a recurrence; a removed member leaves
the scoreboard without losing their history; a nudge is refused when `allowNudges` is off;
the default report card contains no ranking and no streaks.

`smoke-dispatch` grows, using the existing `?now=` time travel — each step fires exactly
once per cycle; a repeat tick adds nothing; acknowledgment cancels remaining steps; nothing
reaches an unconfirmed contact; a blocked contact stays blocked; escalation stops at the nag
limit; aborted transactions stay at zero.

`smoke-templates.mjs` — a second import creates nothing; a family-scope import lands on the
shared list; yearly items resolve to the next occurrence in the importer's timezone.

**Risk:** medium-high, concentrated entirely in 2c and mitigated by the opt-in.

---

## Phase 3 — offline read and write with sync

Last on purpose: phases 1 and 2 add acknowledge, comment, import, nudge and escalation
edits, and an outbox built first would be retrofitted five times.

**Storage.** Hand-rolled IndexedDB wrapper (~120 lines, no dependency): `snapshot` (last
known reminders/categories/families per scope) and `outbox` (queued mutations).
`lib/cache.ts`'s account-owner rule extends to both — the reason it exists there applies
with more force to a store that survives a browser restart.

**Creates work offline** because `Reminder.id` is `@default(uuid())`: the client mints the
UUID, so replaying a queued create is an upsert on a known id and is idempotent with no
server-side dedupe token.

**Conflict rules — the actual decisions.** "Sync with conflict resolution" is a set of
choices, not a merge algorithm, so:

| Mutation | Rule | Why |
| --- | --- | --- |
| Create | Upsert on the client's id | Replay-safe; a retry can't duplicate |
| Complete | **First completion wins.** A later queued one is dropped and the client told who got there first | Two people paying the same bill isn't a conflict to merge — and the second person needs to know it's already paid |
| Snooze | Both applied, `snoozedUntil` takes the **later** value | "Not now" is safe to honour generously |
| Edit | Last-write-wins, **refused** if the server's `updatedAt` is newer than the version the edit was based on — surfaced with both values | Silently overwriting someone's edit is the one outcome nobody can detect afterwards |
| Delete | Wins over a concurrent edit | An edit to something deleted has nowhere to land |

Every mutation carries the `updatedAt` it was based on. That column already exists and
already changes on every write, so it is the version token — no new column.

**Replay** in order, stopping at the first hard failure (4xx) and surfacing it; network and
5xx retry with backoff. A stuck outbox must be visible and individually discardable — a
queue silently holding someone's completions is worse than being told the write failed.

**Service worker.** `public/sw.js` gains a fetch handler: cache-first for shell and static,
network-first for `/api`. **API GET responses are not cached** — the account-scoped leak
risk is real, and the IndexedDB snapshot already covers the same need under our own key
with our own clearing rules.

**Tests.** The sync engine is extracted as a pure module taking a storage interface and a
transport, so `scripts/smoke-offline.mjs` drives it under Node with a fake network: replay
is idempotent; the double-completion race resolves to first-wins; a stale edit is refused;
the outbox survives a simulated restart; a queued mutation for a server-side-deleted
reminder is discarded with a message rather than retried forever.

**Ship in two halves** — snapshot reads plus the offline badge first, which is most of the
felt benefit, then the outbox behind a flag.

**Risk:** high, and inherent rather than positional.

---

## Sequence

```
1. spending awareness ──> 2. family (packs → accountability → escalation) ──> 3. offline
```

2a can start the moment phase 1's shared scope lands. 2c is last within phase 2 because it
depends on acknowledgment existing.

| Phase | Size | What dominates |
| --- | --- | --- |
| 1 | Medium | The history scoping helper and its isolation tests |
| 2 | Large | Surface area — 9 routes, 2 tables, and `smoke-security` grows for each |
| 3 | Large | Conflict handling and a new test harness |

## Deliberately not built

- **Community-shared packs.** Hosting user-authored content means moderation and a report path — a product, not a feature of this one.
- **Financial-year reporting, PDF export, accounting semantics.** Not what this app is for.
- **Member stats older than three months.** See 2b.
- **A second cron job.** Month close, streak advance and pruning all ride the existing daily tick.

## Standing constraints

- Commit straight to `main`; no branches, no PRs.
- Every new route behind `json()`/`jsonAdmin()`, scoped by `userId`/`familyId`, 404 not 403 on ownership failures.
- Every new mutation gets an isolation assertion in `smoke-security` before it ships.
- No new runtime dependency without a reason that survives the bundle cost.
- `D:\prosys for kashish` stays untouched.
