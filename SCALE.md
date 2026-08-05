# Scale and speed

Measured on 4 August 2026 against the live Supabase project (`ap-northeast-1`, Tokyo)
and the deployed app. Numbers here are measurements, not estimates, unless labelled
otherwise.

---

## How much storage a row actually costs

Measured by filling temp tables that mirror the live schema — including their indexes
— with 20,000 synthetic rows each and reading `pg_total_relation_size`.

| table | bytes/row (incl. indexes) | grows with |
|---|---|---|
| `Reminder` | 448 | what people create |
| `ReminderDispatch` | 290 | every alert sent |
| `Notification` | 281 | every alert sent |
| `ActivityLog` | 224 | admin/account actions |

**One alert to one person costs 571 bytes** — a `ReminderDispatch` row to stop it
being sent twice, plus a `Notification` row for the in-app feed.

Current usage: **1.27 MB** in the `public` schema, 12.6 MB for the whole database
(the rest is Postgres' own catalogs and extensions). The Supabase free tier allows
500 MB, so roughly **487 MB is available**.

## What that means in practice

A reminder with two lead alerts fires 3 times per cycle (2 lead + 1 due), so:

| scenario | storage per year |
|---|---|
| One person, 20 monthly reminders | ~0.4 MB |
| Household of 4, 30 shared monthly reminders | ~2.5 MB |
| 50 households of 4 | ~125 MB |

**On the free tier, ~200 household-years fit in the available space.** Put another
way: 50 families using it properly would take about four years to fill it, and a few
hundred solo users would take longer than that.

Steady-state growth is not the thing to worry about. Two other things were.

## The two problems this analysis found, and the fixes

**Overdue nagging was unbounded.** `offsetMin` on an overdue alert is
minutes-since-due, so it increases forever and every nag was therefore a *new*
dedupe row and a *new* notification. A reminder left uncompleted nagged hourly
indefinitely: 24 alerts a day, 13.7 kB a day, **5 MB a year — from a single abandoned
reminder**, more than an entire active household of four generates. A hundred of them
would have eaten the whole quota in a year, and the app would have looked like it was
storing nothing much.

Nagging now stops after **14 days overdue** (`OVERDUE_NAG_LIMIT_DAYS` in
`lib/dispatch.ts`). The reminder stays in the list, overdue and visible; only the
notifications stop. Something a fortnight late is not a reminder any more, and hourly
alerts about it have stopped being information.

**Nothing was ever deleted.** `ReminderDispatch` and `Notification` both grew for the
lifetime of the install. Only `DispatchRun` had a cap.

The first fix was a 90-day window over both, which was wrong about `ReminderDispatch`
in a way that took a second pass to see. Its stated safety was that "a cycle 90 days
behind has either rolled over or stopped nagging" — true of leads, and true of nagging,
but **the due alert has no time cap at all**. So for any active reminder more than 90
days overdue, the hourly prune deleted its due row, the next tick re-planned the due
alert and sent it, and wrote a fresh row for the prune to delete an hour later. An
abandoned reminder nagged hourly forever, having promised to go quiet after a fortnight.
The bound above was real; this one silently undid it.

A window was the wrong shape. Each row becomes unreachable at a provable moment:

| Row | Removed | Why it can never fire again |
| --- | --- | --- |
| any kind, on completion | at once | a one-off ends `completed`, which the query excludes; a recurring one rolls `dueAt` strictly forward. There is no un-complete route |
| any kind, on a `dueAt` or `status` change | at once | every stored `cycleDueAt` is then behind the only cycle that can be planned |
| `lead` | once `cycleDueAt` passes | leads are planned solely in the not-yet-due branch |
| `overdue` | 2 minutes after firing | `offsetMin` is minutes-since-due and only increases, so the slot cannot recur. It guards two ticks inside one minute and nothing else |
| `overdue` that carried an email | 15 days | it is what the 12-hour email cap reads |
| `escalation` | 15 days | no step is planned past the 14-day nag limit |
| `due` | **never, while its reminder is active** | it is the only thing standing between an overdue reminder and a repeat of its due alert, and no age changes that |

Keeping due rows indefinitely holds one row per open cycle per recipient — bounded by
how many reminders people abandon, not by how long the install has run. Capping the due
fire at 14 days would have made a window safe instead, but it would also silence a
legitimately backdated reminder, and unlike leads the due alert has no no-back-fill rule
to lean on. Retained rows now mean "cycles still open" rather than "the last three
months": for a household of four with 30 shared monthly reminders, 692 kB → ~230 kB.

**The feed is the bigger app-side lever, and it is a product choice.** Read
notifications are kept **14 days** — once somebody has read the entry it has done its
job of leaving a trace — and unread ones the full **90**, because an unread alert might
still be news. Same household: 476 kB → ~79 kB.

**Expired logins were never swept at all.** `resolveSession` deletes an expired row when
that exact session is next presented, so a device that never comes back left its row for
good. They are now swept globally; an expired session is unusable by definition, so
there is no window to observe.

**Failed dispatch runs were deliberately unbounded**, on the sound reasoning that the
*oldest* failure is the most useful because it is when the problem started. But a
dispatcher broken for a month reaches ~43,000 rows and 27 MB, and a 30-day window would
not have helped, because a month is the window. The oldest 20 and newest 20 are kept:
the onset survives, so does the current state, and the table cannot exceed 40 rows
however long the outage lasts.

**`MonthlyRollup` had no ceiling of any kind.** The year view reads twelve months, so it
is capped at 24. Roughly 49 kB a year per household — tidiness rather than savings.

It also had the orphan problem in a worse form than the feed. `scopeKey` is a composite
string, `"u:<userId>"` or `"f:<familyId>"`, so no foreign key can cascade: deleting an
account or dissolving a family left its monthly totals behind, and a rollup outlives the
reminders it totalled, so even the "empty the shared list first" rule on dissolve doesn't
help. On this install **147 of 150 rows belonged to 49 scopes that had already gone**.
Rollups whose scope no longer exists are now swept hourly rather than cleared at each of
the four delete sites — a rule that has to be remembered in four places is one that will
be forgotten in one, and sweeping also catches paths nobody has written yet. The guard
that matters is the empty-install check: `notIn []` matches every row, so a database with
no accounts is left alone rather than emptied.

Left alone deliberately: `ReminderHistory`, because that *is* Spending and
`lib/rollup.ts` already prunes it under the rule that a month with no rollup is never
pruned; blocked `ExternalContact` and `PushSubscription` rows, because the block has to
outlive everything and the app re-registers a deleted subscription on the next load.

**The audit log** is separately handled — it is emailed to the owner daily and then
trimmed to its 50 most recent entries, so it holds at a fixed few kB rather than
growing (`lib/audit-rotate.ts`).

## The dispatcher was writing thousands of ERROR lines a day

Found in the Supabase Postgres log:

```
duplicate key value violates unique constraint
  "ReminderDispatch_reminderId_userId_cycleDueAt_kind_offsetMi_key"
```

Nothing was broken — that violation *is* the dedupe. The engine claims a slot by
inserting before it sends, and a collision means "already sent", which the code
handled. But it handled it by catching a raised error, and Postgres logs every
constraint violation at ERROR whether or not the client copes.

The volume is the problem. Every tick re-plans the `due` alert for anything overdue,
so **each overdue reminder produced one failed INSERT per minute per recipient** —
around 1,400 ERROR lines a day, each an aborted transaction, and each
indistinguishable at a glance from a real fault. Ten overdue reminders would have
buried a genuine error under 14,000 lines of normal operation.

The claim is now `createMany` with `skipDuplicates`, which compiles to
`INSERT … ON CONFLICT DO NOTHING`: equally atomic, returns a count of 0 instead of
raising. Measured across four consecutive ticks on an overdue reminder, aborted
transactions went from one per repeat tick to **zero**, and `smoke-dispatch` now
asserts that count stays at zero.

---

## Speed

### The dominant cost was geography, and it still is until one setting changes

```
X-Vercel-Id: bom1::iad1::…
```

The request enters Vercel's Mumbai edge and then **executes in Washington DC**, while
the database is in **Tokyo**. Every query crosses the Pacific, and a page load makes
several.

Measured against production:

| endpoint | time |
|---|---|
| `/api/health` (no database) | 0.34–0.46 s |
| `/api/auth/status` (one query) | 0.50 s warm, 1.87 s cold |
| `/api/auth/login` (query + bcrypt) | 0.67 s |

`vercel.json` now declares `"regions": ["hnd1"]` (Tokyo), but **on the Hobby plan the
dashboard setting is what actually applies**:

> Vercel → Project → Settings → Functions → Function Region → **Tokyo (hnd1)**

Verify with:

```bash
curl -sD - -o /dev/null https://pro-sys-by-rishi.vercel.app/api/health | grep -i x-vercel-id
```

The second value is the one that matters — it should read `hnd1`.

Tokyo is the right choice on two counts: it sits next to the database, turning ~170 ms
round trips into single digits, and from India it is roughly half the distance of
Virginia.

> **Better still, later:** the ideal is database *and* functions near the user. If the
> Supabase project is ever recreated, choose `ap-south-1` (Mumbai) and set the function
> region to `bom1`. That is a project migration rather than a setting, so it is not
> worth doing for its own sake — but worth taking if the project moves anyway.

### Requests per page load: 4 → 1

The shell was fetching `/auth/me`, then `/settings`, then `/families` — **strictly
serial**, each one a separate serverless function that re-resolved the session before
doing its own work, with nothing on screen until the last returned. A fourth call
computed six dashboard aggregates to render one badge number.

`/api/bootstrap` returns all of it in one round trip. `/api/badge` serves the two
numbers the chrome needs as two `COUNT`s — the header was previously fetching up to
100 notification rows, every column of each, to render one digit.

This matters far more while functions are in the wrong region: four serial round trips
at ~200 ms each is most of a second of nothing.

### How fast the dispatcher has to be

It runs every minute, so **a tick must finish inside 60 seconds** or ticks overlap.
The route's `maxDuration` is 60 s to match.

Observed durations are 2–15 s, but that figure is from a laptop in India talking to
Tokyo — it is dominated by the same round-trip cost as everything else, and is not
what production pays. The work per tick is one indexed query for due reminders plus, per
alert, a dedupe insert and the sends.

Headroom is large: the query is bounded by *active reminders near their due time*, not
by table size. At 50 households the interesting set is single digits per tick. The
first thing that would push a tick towards the limit is web-push latency during a
fan-out to many devices at once, since those are sequential HTTP calls — that is the
number to watch on the admin health page, where `Took` is recorded for every run.

---

## Where the ceilings actually are

| limit | current | headroom |
|---|---|---|
| Database, 500 MB free tier | 12.6 MB | ~200 household-years |
| Dispatch tick, 60 s | 2–15 s (over a trans-Pacific link) | large; watch `Took` |
| Vercel Hobby function invocations | 1 tick/min = ~44k/month | comfortable |

The free tier's real constraint is not size — it is that a project **pauses after 7
days of inactivity**, which stops pg_cron and therefore all reminders. An install in
regular use never hits it.
