# PRO-SYS

A **multi-user personal reminder app** — never miss a bill, birthday, renewal, or
anything else that's due. Reminders are **time-based**, and they reach you by
**push notification** on your lock screen, by **email**, or both — each person
chooses.

## Architecture

A **single Next.js 15 app** (this repo) containing both the UI and the API:

- **UI** — React 19, TypeScript, Tailwind CSS (App Router pages), installable as a PWA.
- **API** — Next.js Route Handlers under `app/api/*` (auth, users, reminders,
  categories, reports, notifications, push, WebAuthn, sessions, settings).
- **Database** — PostgreSQL via Prisma 7 (Supabase).
- **Notifications** — Web Push (VAPID) straight to the device, and/or SMTP email.
- **Scheduling** — Supabase `pg_cron` calls `/api/cron/dispatch` every minute.

One origin → one server, one deploy, no CORS.

## Two kinds of account

Chosen at signup, switchable later either way:

- **Single person** — your reminders, private to you. Nothing else to think about.
- **Family** — the same private list, *plus* membership of one or more families,
  each with a **shared reminder list** every member can see.

A family is a group of separate accounts, not a shared login. Everyone keeps their
own email, PIN, devices and preferences.

### Families

The person who creates a family is its **head**. They get a short **join code** to
hand out; entering a valid code joins that family immediately. The code *is* the
permission, so the head's controls are handing it out directly, rotating it, and
removing a member.

Reminders live in one of two places, chosen when you create them: **Mine**
(private) or a family's shared list. Each family reminder can be **assigned** to a
member, and picks who gets alerted:

| Notify | Who hears about it |
| --- | --- |
| Only me | The creator |
| The assigned member | The assignee, falling back to the creator |
| Everyone in the family | Every member |

Any member can **complete or snooze** something on the shared list — that's what
makes it shared. A recipient can also tap **I'll handle it**, which tells everyone
somebody has it and pauses any escalation, and anyone who can see a reminder can leave
a **note** on it, so a shared list doesn't need a chat app beside it.

Each family has an **activity feed** (who completed what, and what was said) and a
**this month** panel showing each member's assigned / completed / on-time counts. Both
are always on. What is **off until the head switches it on**: ordering members against
each other, streak badges, and letting members nudge each other. A household that
hasn't asked to be a league table isn't one.

The head also gets a **monthly summary by email**, on by default. It carries only what is
switched on above, so unless you change anything it is completion counts with no ordering
and no streaks.

Editing, reassigning and changing the audience stay with the creator and the head,
because those change the thing for everyone.

The head can rename the family, rotate the join code, remove members, hand over
headship, and dissolve it. **Dissolving is refused while any reminder is
still on the shared list** — clear them first, so it can never destroy work as a
side effect. A head must hand over before leaving, so a family is never left with
nobody able to administer it.

## Accounts: verification and privacy

Everyone gets their own account, and your personal reminders are **not visible to
other users**.

An **administrator of the install can view any account's reminders** for support,
and every such view is written to the audit log. That's a deliberate trade of
privacy for debuggability — worth knowing, since the app says so in Settings rather
than promising something it doesn't deliver.

- **Signing up** is self-service: name, email, and a 4-digit PIN.
- **Clicking the link in the confirmation email** is what activates the account. No
  admin is involved — approval asked one to judge a name and an address they had
  never seen, which was not a real check, while the person who signed up waited on
  someone they had no way to contact. Proving you can read the address is both a
  real check and one you can complete yourself.
- The link is single-use and lasts **24 hours**. A blocked sign-in offers to send
  another; so does the signup screen.
- An admin can still **activate or reject an account by hand**. That is the fallback
  when mail is misconfigured, and the accounts list distinguishes "email confirmed"
  from "not confirmed yet" so it is clear which is which.
- **No account is ever made admin automatically.** One account holds `isRootAdmin` —
  the install's owner — and it is promoted by hand once at deploy time
  (see [DEPLOY.md](DEPLOY.md)). It is the one row no other admin can demote, reject,
  delete or reset the PIN of, so an admin it promoted can never lock it out, and
  ownership moves only when the owner hands it over. The alternative, granting admin
  to whoever registers first on an empty database, saved one SQL statement and cost a
  capture window.
- Mail to reserved domains (`.invalid`, `.test`, `example.com`, …) is **refused
  outright** rather than attempted. Those are accepted at submission and bounce
  minutes later, which makes a send look successful when it was not.
- Admins work in the **`/admin` panel**, not Settings:
  - **Accounts** — every account with its verification state, search, roles, PIN
    resets for people locked out, and a reminder viewer.
  - **Families** — every household on the install; rename, appoint a head, remove
    members, dissolve.
  - **Health** — whether SMTP, VAPID and `CRON_SECRET` are actually set, the last
    few dispatch runs with counts, and devices failing to receive. A broken
    dispatcher and an idle one both send nothing; the run history is what tells
    them apart.
  - **Audit log** — verifications, role changes, deletions, family membership
    changes, and every admin read of someone else's reminders. It is **emailed to the
    owner as a CSV once a day** and then trimmed to its **50 most recent entries**, so
    the live log stays short enough to scan and still answers "what just happened".
    Nothing is deleted unless the mail was accepted.
- An admin can't act on their own row, and nobody can act on the owner's. Between
  them that is why no "is this the last admin?" counting exists anywhere.

## Login

**Email + PIN.** A **passkey** (Face ID / Touch ID / Windows Hello) can be added
from **Settings → Security**; the PIN stays as the fallback so a lost passkey never
locks you out. Passkeys are discoverable credentials, so the lock screen doesn't
need to be told who you are first — and the login page never reveals who has an
account here.

Sessions are stored in the database, so **Settings → Security** can list every
active login and sign any of them out, and an optional inactivity timeout is
enforced server-side rather than merely honoured by the browser.

## Spending

Reminders carry an amount, so completing them records what you paid. **Spending** shows
this month's total, a per-category breakdown, each category against its own 3-month
average, what's due in the next 7 days, and a rolling twelve months. CSV download for
the last three months.

Not a budgeting tool and not an accounting one: no financial year, no envelopes, nothing
to set up. It answers "roughly what have I been spending, and what's about to land".
Older months are kept as monthly totals only, and deleting a reminder removes its
history — the download says so.

## Escalation

Per reminder, up to two steps: **if this still isn't done N hours late, tell someone
else** — the assignee again, the family head, an admin, or an address outside the app
entirely. Escalation stops the moment somebody says they'll handle it.

An outside address is asked **once** whether it wants this at all, and nothing reaches
it until it agrees; declining blocks it permanently for everyone. That isn't politeness —
every message this install sends leaves through one Gmail account, and unconfirmed mail
to strangers is what gets a sender throttled.

## Reminders

Each reminder has an explicit **date and time**. Omit the time and it lands on your
default (**05:30** in your timezone, both configurable in Settings).

Per reminder you tick which **advance alerts** you want — 1 week, 1 day, 4 hours,
1 hour, 30 minutes, 10 minutes before. You always also get one **at the due time**.
After that it **keeps nagging** on an interval (hourly by default) until you hit
**Complete** or **Snooze**.

Recurring reminders (Daily → Yearly) roll their due date forward on completion,
preserving the time of day, and their alerts re-arm automatically.

Engine: [`lib/dispatch.ts`](lib/dispatch.ts) + [`lib/push.ts`](lib/push.ts) +
[`lib/mail.ts`](lib/mail.ts) + [`public/sw.js`](public/sw.js).

### Channels

Choose either or both in **Settings → How you're reminded**. Whatever you pick,
every alert is also recorded in the in-app Notifications list, so a failed delivery
still leaves a trace.

- **Push** carries **Complete** and **Snooze 1h** action buttons, and the app icon
  shows a **badge count** of everything due or overdue. Setting it up doesn't
  require finding Settings: a banner appears at the top of any page when the current
  device can't receive notifications, and turning them on is one tap. If permission
  is already granted the app silently re-registers the device on every load, so a
  subscription that was pruned, rotated by iOS, or deleted by hand repairs itself
  instead of failing quietly.
- **Email** sends every lead and due-time alert, but caps **overdue repeats at one
  every 12 hours** no matter how short your nag interval is. Push nags collapse into
  a single lock-screen notification; an inbox has no equivalent, and hourly mail
  about the same unpaid bill is how people learn to ignore an app.

## Offline

The app opens and works without a connection. Pages you have visited paint from the
last copy saved on this device, and a strip at the top says so rather than each page
showing its own failed-request error over data that is perfectly good.

**Changes made offline are queued, not lost.** Add, edit, complete, snooze, delete,
claim and comment all work with no signal; a row that is waiting says "waiting to
sync", and the queue itself is visible with a discard button per item. It goes out on
its own when the connection returns, when the app comes back to the foreground, or on
a slow poll for the case where the network never technically went away.

What happens when a queued change disagrees with the server is decided, not merged:

| Change | Rule |
| --- | --- |
| Add | Replayed onto the id the client minted, so a lost response can't make a second reminder |
| Complete | **First completion wins.** A later one is dropped and names who got there first — two people paying the same bill isn't a conflict to merge |
| Snooze | Whichever silence lasts longer wins |
| Edit | **Refused** if the reminder changed elsewhere after the edit was composed. Silently overwriting somebody's edit is the one outcome nobody can detect afterwards |
| Delete | Beats a concurrent edit — an edit to something deleted has nowhere to land |
| Claim | First wins, like completion |
| Note | Append-only, replayed by its own id |

Signing out sends anything queued first, and warns before discarding what it can't.
An idle auto-lock keeps the queue instead — that is the same person coming back, not a
handover. Signing in as somebody else drops it, because it could never be replayed
under their session anyway.

Reads are [`public/sw.js`](public/sw.js) + [`lib/net.ts`](lib/net.ts) +
[`lib/cache.ts`](lib/cache.ts); writes are [`lib/sync.ts`](lib/sync.ts) (the decisions,
pure and testable) + [`lib/idb.ts`](lib/idb.ts) + [`lib/offline.ts`](lib/offline.ts).
Set `NEXT_PUBLIC_OFFLINE_WRITES=0` to turn queueing off and leave the reads alone.

## 📱 iPhone: install to the Home Screen first

**iOS only delivers web push to an installed PWA, never to a Safari tab.** Open the
app in Safari → **Share** → **Add to Home Screen**, then launch it from that icon
and enable notifications in Settings. Requires iOS 16.4+.

Notifications use your iPhone's standard notification tone — iOS gives web apps no
way to pick their own sound. Change it under the iPhone's Settings → Notifications
→ PRO-SYS.

## Deployment (free)

One Vercel project (Root Directory = repo root) + Supabase (free) + `pg_cron`, plus
your own Gmail if you want email. See **[DEPLOY.md](DEPLOY.md)**.

## Local development

```bash
npm install
cp .env.example .env    # DATABASE_URL, AUTH_SECRET; VAPID keys and SMTP optional
npm run dev             # http://localhost:3000
```

If the database is empty, create the tables first (see DEPLOY.md — use Supabase's
**session pooler (port 5432)** for `prisma db push`).

Regenerate the PWA icon set after changing the wordmark:

```bash
node scripts/generate-icons.mjs
```

### Smoke suites

With the dev server running, these check the things that break quietly.

The reminder engine — lead/due/overdue ordering, the nag interval, no back-fill,
snooze, dedupe against a repeated cron tick, and recurrence re-arming. It uses the
dev-only `?now=` override, so it takes seconds rather than real minutes:

```bash
node --env-file=.env scripts/smoke-dispatch.mjs
```

Isolation — that one user can't read, edit, delete or snooze another's reminders,
can't borrow their categories, can't reach the admin API, and that ownership can't
be set from the request body. Also **cross-family**: that two families can't see
each other, that a family member can't see another member's *personal* list, that a
plain member can't administer the family, and that a removed member loses access
immediately:

```bash
node --env-file=.env scripts/smoke-security.mjs
```

Email verification — what activates an account now, which makes the token a bearer
credential: whoever holds it turns a stranger's signup into a usable login. So the
assertions that matter are the negative ones — a wrong token, a spent one, an expired
one, and one for an account an admin already rejected:

```bash
node --env-file=.env scripts/smoke-verify-email.mjs
```

Run history — keep the newest 10 successful dispatch runs, keep every failed one:

```bash
node --env-file=.env scripts/smoke-run-history.mjs
```

Audit rotation — the daily dump. The property it rests on is that **nothing is
deleted unless the email was accepted**, so a mail outage delays the trim rather than
destroying the trail. Both sides of the send are forced through dev-only query
parameters, because neither can be provoked for real; no mail leaves the machine.
It also copies the existing log out and puts it back, so a run can't cost you history:

```bash
node --env-file=.env scripts/smoke-audit-rotate.mjs
```

Rotation happens once a calendar day, so on a database this install's production cron
also rotates, the day is spent from just after midnight and this suite could only pass
in the window before the first real tick. `?forceAuditRotate=1` skips that day check —
dev-only, and refused unless `failAuditMail=1` or `fakeAuditMail=1` is set too, so a
forced rotation can never send real mail. The suite also leaves one rotation marker in
place while it runs: emptying the log removed production's own marker, so its next tick
found no rotation for today and mailed the owner a dump of the suite's fake rows.

Spending insights — the totals, and more importantly the scoping. These routes read
`ReminderHistory` rather than `Reminder`, so they bypass `lib/ownership.ts` entirely; a
missing clause leaks money rather than throwing. Also covers the month close and the
history prune, whose one inviolable rule is that **a month with no rollup is never
pruned**:

```bash
node --env-file=.env scripts/smoke-insights.mjs
```

Family accountability and escalation — mostly negative assertions, because
everything here writes to a *shared* row: who may not acknowledge, comment, nudge or read
a scoreboard. The escalation section drives `?now=` time travel, since it changes
`planFires()` in `lib/dispatch.ts` — the one file where a bug means silence:

```bash
node --env-file=.env scripts/smoke-family.mjs
```

Offline sync — the only suite that tests decisions which cannot be reached by hand.
Turning wifi off, tapping Complete and hoping exercises one ordering once; this drives
`lib/sync.ts` under Node against a fake network, which is why that file has no React, no
IndexedDB and no fetch in it. Then the same guarantees against the live routes, because
idempotency the client believes in and the server doesn't have turns a retry into a
duplicate. It also parses `public/sw.js`, which nothing else does — that file has no
build step, no types and no lint, and a syntax error in it silently kills push delivery
along with everything else:

```bash
node --env-file=.env scripts/smoke-offline.mjs
```

Route contracts — the edges nobody exercises by hand. Every protected route refuses
an anonymous caller with 401; every method a route doesn't declare answers 405; a
malformed body is a 400 rather than a 500; an unknown id is a 404 rather than a
crash; every query parameter can be given rubbish. A 500 is the interesting failure
here — it means a bad request reached code that assumed a good one:

```bash
node --env-file=.env scripts/smoke-routes.mjs
```

They all seed throwaway accounts with **both channels switched off** and delete them
afterwards, so none of them ever emails or pushes anywhere. `smoke-dispatch`
additionally refuses to run while any device is subscribed to push, and every suite
refuses to run against a database holding real accounts (override with
`SMOKE_FORCE=1`). The two that empty a whole table — `smoke-audit-rotate` and
`smoke-run-history` — restore its rows afterwards regardless of that override, because
a guard you can switch off is a guard that will be switched off.

> **Tip:** don't run `npm run build` while `npm run dev` is running — they share the
> `.next` folder and corrupt it. Stop dev first.
>
> Same for `prisma generate`: a running dev server holds the old client in memory, so a
> newly added column reads as undefined and writes fail in ways that look like a bug in
> whatever you were testing. Restart dev after regenerating.
