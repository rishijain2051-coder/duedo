# Plan — offline read and write with sync

**Status, 4 August 2026.** Phases 1 and 2 are built, deployed and live. Phase 3 is
**deliberately on hold** — the app is already a PWA with a localStorage-cached shell, so
the remaining gap is data rather than the app failing to open.

The delivered halves are documented in the code and the README; what follows is what is
left, plus the handful of places the build deviated from the original plan and why.

| Phase | Commit | State |
| --- | --- | --- |
| 1 — spending awareness | `55ab5d8` | live |
| 2 — family accountability, packs, escalation | `eb66af7` | live |
| 3 — offline read and write with sync | — | **on hold** |

---

## Where phases 1 and 2 deviated from the plan

Recorded because none of it is obvious from the code alone.

**Streaks became counters, not a query.** The plan had them computed. They can't be:
history is pruned at three months, so a computed weekly streak could never exceed about
thirteen and the "12 weeks straight" the feature rests on was unreachable. Four integers on
`FamilyMember`, advanced at each period close, survive the prune and reach any length. This
resolved the conflict between "both weekly and monthly streaks" and "prune at 3 months"
rather than trading one against the other.

**`MonthlyMemberRollup` was dropped.** The plan had two rollup tables. Per-member figures
are computed live from the three months of retained detail, which covers "this month" and
"last month" — the only windows anyone looks at. The cost is that per-member history older
than three months doesn't exist. Nobody asked for it, and a second table was exactly the
complication being avoided.

**`ReminderHistory` keeps its cascade.** Deleting a reminder still deletes its payment
history, by decision. The CSV export states so in its first line, so a total that looks
short has a visible reason.

**Frozen category labels on history were dropped.** The rollup freezes its own copy, so a
closed month keeps the name it had; the three months of detail read the live category,
which is what people expect after renaming one.

**Escalation needed no new dedupe machinery.** Using a step's own `afterMins` as
`offsetMin` means the existing unique key
`(reminderId, userId, cycleDueAt, kind, offsetMin)` already makes each step fire once per
cycle per recipient. That it generalised untouched is a good sign the key was right.

**A `firedEscalation` column was added to `DispatchRun`.** Not in the plan. The admin
health page has to be able to answer "why was somebody outside the app written to" without
guessing, and folding it into `firedOverdue` would have made that impossible.

---

## Phase 3 — offline read and write with sync

Last on purpose: phases 1 and 2 added acknowledge, comment, nudge, import and escalation
edits, and an outbox built first would have been retrofitted five times. That set is now
stable, which is the precondition this phase was waiting for.

**Recommended shape: two commits.** Snapshot reads and the offline badge first — most of
the felt benefit for a fraction of the risk — then the outbox behind a flag, so a sync
problem can be switched off without losing the reads.

### Storage

Hand-rolled IndexedDB wrapper (~120 lines, no dependency), two stores:

- `snapshot` — last known reminders / categories / families, per scope
- `outbox` — queued mutations

`lib/cache.ts`'s account-owner rule extends to both. The reason it exists there applies
with more force to a store that survives a browser restart: without it, signing in as
somebody else on a shared laptop paints the previous person's reminders.

### Creates work offline for free

`Reminder.id` is `@default(uuid())`, so the client can mint the id. Replaying a queued
create is then an upsert on a known id and is idempotent with no server-side dedupe token.

### Conflict rules — decisions, not an algorithm

| Mutation | Rule | Why |
| --- | --- | --- |
| Create | Upsert on the client's id | Replay-safe; a retry can't duplicate |
| Complete | **First completion wins.** A later queued one is dropped and the client told who got there first | Two people paying the same bill isn't a conflict to merge — and the second person needs to know it's already paid |
| Snooze | Both applied, `snoozedUntil` takes the **later** value | "Not now" is safe to honour generously |
| Edit | Last-write-wins, **refused** if the server's `updatedAt` is newer than the version the edit was based on — surfaced with both values | Silently overwriting someone's edit is the one outcome nobody can detect afterwards |
| Delete | Wins over a concurrent edit | An edit to something deleted has nowhere to land |
| Acknowledge | First wins, like completion — the route already behaves this way | Added since the plan was written; the API is already idempotent here |
| Comment | Append-only, replay by client id | Two people writing notes is not a conflict at all |

Every mutation carries the `updatedAt` it was based on. That column already exists and
already changes on every write, so it is the version token — no new column. `Reminder` in
`types/index.ts` now declares `updatedAt` for exactly this.

### Replay

In order, stopping at the first hard failure (4xx) and surfacing it; network and 5xx retry
with backoff. A stuck outbox must be **visible and individually discardable** — a queue
silently holding someone's completions is worse than being told the write failed.

### Service worker

`public/sw.js` gains a fetch handler: cache-first for shell and static, network-first for
`/api`. **API GET responses are not cached** — the account-scoped leak risk is real, and
the IndexedDB snapshot already covers the same need under our own key with our own clearing
rules.

This is the sticky part of the phase and the reason for splitting the commits: a bad
service worker can survive a deploy and keep serving old code. `lib/update.ts` and the
update banner already exist to detect a stale build, and they should be exercised
deliberately as part of this work rather than trusted.

### Tests

Extract the sync engine as a pure module taking a storage interface and a transport, so
`scripts/smoke-offline.mjs` can drive it under Node with a fake network:

- replay is idempotent
- the double-completion race resolves to first-wins
- a stale edit is refused rather than applied
- the outbox survives a simulated restart
- a queued mutation for a server-side-deleted reminder is discarded with a message rather
  than retried forever

### Risk

High, and inherent rather than positional — the only phase of the three where that is true.

---

## Deliberately not built

- **Community-shared packs.** Hosting lists other people wrote means moderation and a
  report path: a product, not a feature of this one.
- **Financial-year reporting, PDF export, accounting semantics.** Not what this app is for.
- **Per-member statistics older than three months.** See the deviations above.
- **A second cron job.** Month close, streak advance, history pruning and the audit
  rotation all ride the existing minute tick, sampled where they need to be.
- **Assign directly from a notification.** Impossible rather than declined: action buttons
  are fixed when a push is sent, so no picker can live inside one. The Assign action
  deep-links to the picker instead.

## Standing constraints

- Commit straight to `main`; no branches, no PRs.
- Every new route behind `json()`/`jsonAdmin()`, scoped by `userId`/`familyId`, 404 not 403
  on ownership failures.
- Every new mutation gets an isolation assertion in `smoke-security` or `smoke-family`
  before it ships.
- No new runtime dependency without a reason that survives the bundle cost.
- Restart `next dev` after `prisma generate` — a running server holds the old client, and a
  new column then reads as undefined while writes fail silently.
- `D:\prosys for kashish` stays untouched.
