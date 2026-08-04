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
lifetime of the install. Only `DispatchRun` had a cap. Both are now pruned past
**90 days** (`RETENTION_DAYS`), which makes total storage a function of active use
rather than of how long the install has existed. The prune runs on roughly one tick in
sixty and is an indexed range scan.

Pruning an overdue dedupe row cannot cause a duplicate alert: the `offsetMin` slot it
guarded only ever moves forward, so it can never come round again.

**The audit log** is separately handled — it is emailed to the main admin and cleared
daily, so it no longer grows at all (`lib/audit-rotate.ts`).

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
