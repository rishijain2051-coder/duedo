# Plan — built, and where it diverged

**Status, 5 August 2026.** All three phases are built and live.

| Phase | Commit | State |
| --- | --- | --- |
| 1 — spending awareness | `55ab5d8` | live |
| 2 — family accountability, packs, escalation | `eb66af7` | live |
| 3a — open and read offline | `0aeb9ad` | live |
| 3b — queue writes made offline | this commit | live |

Kept as a record of the decisions, because none of it is obvious from the code alone.

---

## Where phases 1 and 2 diverged

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

## Where phase 3 diverged

**The snapshot stayed in localStorage; only the outbox went to IndexedDB.** The plan
had two IndexedDB stores. IndexedDB is asynchronous, and the reason `useCached` paints
instantly is that it reads localStorage *synchronously in a layout effect, before the
browser paints* — moving the snapshot there would have traded the feature's main
benefit for nothing. A household's reminders are tens of kilobytes, nowhere near the
localStorage budget. So: one store, for the thing that actually needs durability.

**Page documents are cached network-first, not cache-first.** The plan said cache-first
for the shell. The worker's original comment was right that a stale HTML document is a
worse bug than a slow cold load — which is an argument against cache-first, not against
caching. Network-first cannot serve a stale document while there is a connection, and
falls back to a stored one only when the fetch fails.

**"Serve any cached page as a shell" was wrong and was removed.** It was the first
version, on the theory that the router would re-route on hydration. It doesn't: an App
Router document carries the render of its own route, so answering `/insights` with the
stored `/reminders` document showed the reminders page under the `/insights` URL. Found
by walking it. A route never opened on this device now says so.

**Immutability is read from the response, not the path.** `next dev` serves the same
`/_next/static` paths unhashed and `no-store`, so a path-prefix rule would have pinned
the first chunk ever fetched and broken every later edit. Only assets the server marks
`immutable` are cached.

**A replay stops at a refusal only for the same reminder.** The plan said stop the whole
queue at the first hard failure. That lets one rejected edit strand five unrelated
completions behind it. Ordering only matters within a reminder — a create must land
before the completion of the thing it created — so a refusal holds back later writes on
that reminder and nothing else. A lost connection or a lapsed session still stops
everything, because neither is about the item being sent.

**A unique index on `(reminderId, cycleDueAt)` was added.** Not in the plan, and it
fixes a live bug rather than an offline one: two people tapping Complete on the same
shared bill in the same second both wrote a history row and the money was counted
twice. The route checks first so the loser gets a message naming who won; the index is
what makes the race impossible rather than unlikely.

**`lib/reminder-logic.ts` no longer imports `lib/recipients.ts`.** It only wanted
`isAudience`, which `recipients.ts` re-exports from `@/types` — but `recipients.ts`
imports prisma, which made the whole file, including the recurrence arithmetic,
unreachable from a client component. The offline projection needs `computeNextDueAt` to
show a completed recurring reminder at its next date, and a second copy of that rule
would be a second thing to keep in step.

**Sign-out and the idle auto-lock now differ.** They were one path. Pressing Logout is a
handover: the queue is cleared with the cache, and the user is warned first if anything
would be lost. An idle lock is the same person coming back in a minute with nobody there
to answer a prompt, so it keeps the queue. Signing in as a different account drops it.

**`unacknowledge` and deleting a note are not queued.** Both are corrections to an
action taken seconds earlier, they are rare, and each would have added a conflict case
to the table for no benefit. Offline they report that plainly instead.

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
- **Caching API responses in the service worker.** Per-account data under a key the app
  doesn't control, on a device that may be shared. The snapshot covers the same need
  under the cache-owner rule, with clearing rules this app decides.
- **Background Sync.** Would replay the queue with the app closed, and is Chromium-only
  — so the foreground path has to exist and be correct regardless. Adding it would mean
  a second replay path that no test can drive.

## Standing constraints

- Commit straight to `main`; no branches, no PRs.
- Every new route behind `json()`/`jsonAdmin()`, scoped by `userId`/`familyId`, 404 not 403
  on ownership failures.
- Every new mutation gets an isolation assertion in `smoke-security` or `smoke-family`
  before it ships.
- No new runtime dependency without a reason that survives the bundle cost.
- Restart `next dev` after `prisma generate` — a running server holds the old client, and a
  new column then reads as undefined while writes fail silently.
- `public/sw.js` has no build step, no types and no lint. `smoke-offline` parses it;
  editing it without running that suite is how push delivery breaks silently.
- Renaming a cache in `public/sw.js` is the only way a bad stored copy — including
  `offline.html` — is abandoned on devices that already have it.
- `D:\prosys for kashish` stays untouched.
