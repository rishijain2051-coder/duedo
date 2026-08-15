# DueDo

**Just missed it? Never again.** Bills, birthdays, renewals — sorted.

A **multi-user personal reminder app**. Reminders are **time-based**, and they reach
you by **push notification** on your lock screen, by **email**, or both — each person
chooses.

> Renamed from **PRO-SYS** in August 2026, which is why older commits, the
> `D:\prosys for kashish` fork it shares ancestry with, and any passkey or API token
> issued before then still carry the old name. The database was not touched by the
> rename; the deployment moved to a new Vercel project, so every client-side store
> (cookies, cached data, service-worker caches, passkeys) starts fresh on the new
> domain — see [DEPLOY.md](DEPLOY.md).

## Architecture

A **single Next.js 15 app** (this repo) containing both the UI and the API:

- **UI** — React 19, TypeScript, Tailwind CSS (App Router pages), installable as a PWA.
- **API** — Next.js Route Handlers under `app/api/*` (auth, users, reminders,
  categories, reports, notifications, push, WebAuthn, sessions, settings).
- **Database** — PostgreSQL via Prisma 7 (Supabase).
- **Notifications** — Web Push (VAPID) straight to the device, and/or SMTP email.
- **Scheduling** — Supabase `pg_cron` calls `/api/cron/dispatch` every minute.

One origin → one server, one deploy, no CORS.

### Two root layouts

`app/` splits into two route groups, each with its own `<html>` and `<body>`:

| | |
| --- | --- |
| `app/(marketing)` | `/` only — the public landing page. Dark, GSAP and Lenis, four display faces. |
| `app/(app)` | everything behind a PIN: `/dashboard`, `/reminders`, `/settings`, `/admin`… |

The split is structural, not stylistic. The landing carries ~75 KB of motion library
and four font families no signed-in screen has any use for, and its stylesheet owns
`body`, `*`, `::selection` and the scrollbar — rules that would otherwise land on every
authenticated page. With separate documents the app *cannot* load them and the landing
cannot load Tailwind, so neither is a matter of remembering to be careful. Confirmed on
the built output: `gsap` appears in the marketing chunk and in zero app chunks.

The cost is that moving between the groups is a full page load. That is the right trade
for a link somebody follows once.

Two consequences worth knowing:

- **The dashboard is `/dashboard`.** It used to be `/`. `middleware.ts` matches `/` and
  nothing else, and redirects to `/dashboard` when the session cookie is present — so
  the landing stays a static document for the visitors it was written for.
- **The manifest's `start_url` is `/dashboard`.** An installed PWA must never launch
  into the marketing page, and a redirect at `/` would break launching offline: the
  service worker deliberately does not cache a redirected response, so there would be
  nothing to answer with.

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

## Learning the app

Two things, and the difference between them is that one is read and the other is done.

**The introduction** ([`lib/walkthrough.ts`](lib/walkthrough.ts)) is a stepped dialog on
a new account's first authenticated load: what a reminder is, the nudges that chase it,
where notifications arrive, what each screen is for. About a minute.

**The guided tours** ([`lib/tours.ts`](lib/tours.ts)) are one per page. They dim the
screen, put a ring around a real control, and explain that control standing on the page
it lives on — the Mine/family switch, the date field, "If it's still not done", the
timezone, the passkey. The copy is allowed to be concrete because of it: an electricity
bill on the 5th, ₹2,400, rather than "your item" and "a value". Finishing one offers the
next, so the seven of them chain into a single run from Dashboard to Settings; the **?**
in the header starts whichever one belongs to the page you are already on.

**Skip is on every step of both**, and it counts exactly the same as finishing, because
a first run that won't take no for an answer is one people close without reading. What
makes that affordable is **Settings → Walkthrough**, which puts either back.

Three things worth knowing about how the tours are built:

- **Steps point at `data-tour="…"`, never at a class name.** A class is a styling
  decision anybody may change; an attribute is a contract, it is greppable, and the
  smoke suite reads `lib/tours.ts` and checks that every anchor a tour names still
  exists in the page that owns it. Without that, renaming an element leaves the tour
  running, the step silently skipped, and the only person who would notice is the new
  user who never learns what they were meant to be shown.
- **The dim layer is four rectangles, not one sheet with a hole in it.** A sheet with a
  `clip-path` still swallows the click, so the highlighted button would be lit up and
  dead — and "press this" is the one instruction a tutorial must not lie about.
- **Neither tour is the same for everyone.** Both filter their steps against the
  account, so a solo account is never walked through the family list and nobody is
  toured around a feature their plan doesn't include. That is the difference between a
  walkthrough and an advert, and it is asserted rather than trusted.

"Seen" for the introduction lives on the account (`User.tourSeenAt`), not in the
browser, so finishing it on a laptop doesn't make it run again on the phone. A local
copy is kept as well, purely so a failed PATCH or a day-old cached shell can't re-ask
somebody who already answered.

## Spending

Reminders carry an amount, so completing them records what you paid. **Spending** shows
this month's total, a per-category breakdown, each category against its own 3-month
average, what's due in the next 7 days, and a rolling twelve months. CSV download for
the last three months.

Not a budgeting tool and not an accounting one: no financial year, no envelopes, nothing
to set up. It answers "roughly what have I been spending, and what's about to land".
Older months are kept as monthly totals only, and deleting a reminder removes its
history — the download says so.

Both CSVs this app writes — the download and the daily audit dump — put an apostrophe in
front of any cell starting `=`, `+`, `-`, `@`, tab or return, because a spreadsheet treats
those as a formula to run and the text in them was typed by someone else. Plain numbers
are exempt, so amounts still add up ([`lib/csv.ts`](lib/csv.ts)).

## Plans

Free, Individual (₹99/year) and Family (₹299/year); Enterprise is a "talk to us" line
with nothing behind it, on purpose. What Free holds back is the part a phone's built-in
reminders app can't do — reminding *someone else*, and escalating to a third person when
they don't answer — rather than rationing reminders, which is a comparison Free would
lose. Push notifications and Face ID are on every plan: both cost nothing to run, and
one of them is a security feature.

**There is no checkout.** Taking card payments here means a registered business, KYC and
GST returns, which is weeks of paperwork to charge a few dozen people. So `/upgrade`
opens WhatsApp with the account's email already in the message, payment is arranged
directly, and the owner sets an expiry date by hand under **/admin → Accounts → Plan**.
Set `NEXT_PUBLIC_UPGRADE_WHATSAPP` or the button doesn't appear.

Access is a **date** (`premiumUntil`), never an `isPremium` boolean. A boolean cannot
expire, so remembering who lapsed becomes a person's monthly job — and it can't answer
"who runs out this week", so nobody can be warned before it stops working. The date does
both: grants stack from the later of today and the current expiry, so renewing early
doesn't cost the remaining days and renewing late doesn't back-date. Every grant is
audited with both ends of the move plus a private note of what was paid.

One rule outranks every number: **caps gate creating, never delivering.** Nothing in
[`lib/dispatch.ts`](lib/dispatch.ts) asks about a plan for lead, due or overdue alerts.
When access lapses you keep every reminder you have and it keeps firing — you just can't
add another until you're back under the free cap. Email is the one channel that stops,
because it is the one with a real ceiling; transactional mail (verification, PIN reset,
contact consent) is never gated. A billing lapse silently stopping a medication reminder
is the one failure this app can't afford, and the only way to be sure is for the
dispatcher to have no opinion about money.

Limits live in [`lib/plan.ts`](lib/plan.ts) and are enforced in exactly one place,
[`lib/plan-guard.ts`](lib/plan-guard.ts) — including `POST /api/ingest/reminder`, which
is a create path that never touches the form.

## Escalation

Per reminder, up to two steps: **if this still isn't done N hours late, tell someone
else** — the assignee again, the family head, an admin, or an address outside the app
entirely. Escalation stops the moment somebody says they'll handle it.

An outside address is asked **once** whether it wants this at all, and nothing reaches
it until it agrees; declining blocks it permanently for everyone. That isn't politeness —
every message this install sends leaves through one Gmail account, and unconfirmed mail
to strangers is what gets a sender throttled.

## Reminders

Each reminder has an explicit **date and time**. Omit the time and it lands **ten
minutes from when you saved it** — on the day you chose, or today if you chose no day.

That used to be a configurable default hour, set to 05:30. Saying "remind me to close
the door" at half past three in the afternoon therefore booked it for half past five the
next morning, long after the door mattered, with nothing on screen to say so. A time
nobody picked has to be a time that is soon: "no time" means "shortly", never "at my
usual hour". The setting is gone, since there is no fixed hour left to choose
(`UNTIMED_LEAD_MINUTES` in [`lib/time.ts`](lib/time.ts)).

Per reminder you tick which **advance alerts** you want — 1 week, 1 day, 4 hours,
1 hour, 30 minutes, 10 minutes before. You always also get one **at the due time**.
After that it **keeps nagging** on an interval (hourly by default) until you hit
**Complete** or **Snooze**.

Recurring reminders (Daily → Yearly) roll their due date forward on completion,
preserving the time of day, and their alerts re-arm automatically.

A monthly reminder dated the **29th, 30th or 31st** lands on the last day of any month
too short for it — the 31st of January becomes the 28th of February — rather than
overflowing into the month after and skipping one. It then stays on that shorter day:
the roll works from the previous due date, so restoring the 31st afterwards would mean
storing the day you originally picked, which is a column this schema doesn't have.

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

## Add by voice

"Hey Siri, add reminder" → speak → it is in. No screen, no tap.

Apple Shortcuts supplies the speech-to-text (on device, free). The app supplies one
endpoint, `POST /api/ingest/reminder`, authenticated by a key you generate in
**Settings → Add by voice**. The key is shown once — it is stored as an HMAC, so there
is nothing to show it from a second time.

**What the key can do:** add a reminder. That is the whole list. It cannot read a
reminder, cannot sign in, and cannot reach any other route. There is one per account,
so generating a new one is also how you revoke the old.

### Getting the shortcut

Settings → **Add by voice** → **Create key**, then **Get the shortcut**. It opens an
iCloud link, installs, and asks for nothing. Paste the key into the Authorization
header of its **Get Contents of URL** action, and say "Hey Siri, add reminder".

The link carries a **placeholder** rather than anybody's key, which is what makes one
link safe for everyone — a shortcut holding one person's key would file the whole
household's reminders into that one account. Each person makes their own key in their
own Settings.

**Why a link and not a file.** The app used to generate the `.shortcut` itself. That
file was a correct property list — XML first, then binary, both verified against a real
plist reader — and Shortcuts on iOS 26 opened it and did nothing at all: no preview, no
button, no error. Apple issues shortcut signatures against an Apple ID, so there is no
keypair to hold and nothing a locally written file can be given to make it acceptable.
An iCloud share link is Apple doing the signing, and it is the only version of this that
works. The generator was deleted rather than left as a button that produces a file iOS
will not open.

#### Or build it by hand

Three actions, if you would rather not use the link — or to see what it contains.

1. Settings → **Add by voice** → **Create key**, and copy it.
2. Shortcuts app → **+** → add these three actions in order:
   - **Dictate Text** (set Language to yours; Stop Listening: *After Pause*)
   - **Get Contents of URL**
     - URL: `https://<your-app>/api/ingest/reminder`
     - **Method: POST first.** Shortcuts hides every body option while the method is
       GET, which makes the next two steps look like they do not exist
     - Headers: `Authorization` = `Bearer <the key you copied>`, and
       `Accept` = `text/plain`
     - Request Body: **JSON**, one field `text` (Text) = the **Dictated Text** variable
   - **Speak Text**, taking **Contents of URL** directly
3. Rename the shortcut to what you want to say — "Add reminder" makes the phrase
   "Hey Siri, add reminder".

The `Accept: text/plain` header is what keeps this to three actions. Without it the
reply is JSON and the sentence has to be dug out with a fourth action, whose input is
easy to attach to the wrong thing — and wrong there is silence, with the screen off and
no way to tell a failed capture from a quiet one.

### What it understands

Say it however you like. Only what you actually say is filled in — nothing is inferred:

| You say | It sets |
|---|---|
| "remind me to **pay the water bill**" | title; today, ten minutes from now |
| "…**tomorrow**", "**on the 15th**", "**next friday**", "**15 September**", "**15/9**", "**in 3 days**", "**end of the month**" | the date |
| "…**at 6pm**", "**at 6:30 pm**", "**at noon**", "**in the evening**" | the time |
| "…**18000 rupees**", "**₹18,500.50**", "**rs 900**" | the amount |
| "…**every month**", "**weekly**", "**quarterly**", "**at the end of every month**" | the recurrence |
| "…**urgent**" / "**low priority**" | the priority |
| "…**under Utility Bills**" | the category, matched by name |
| "…**note the meter reading is 4321**" | the notes |

Anything it does not recognise stays in the title, where you can see it — a reminder
on the wrong day is worse than one with no date, because the wrong day looks handled.
Two deliberate refusals to guess: **"end of the month" is a date, "end of every month"
is a schedule**; and a category is only used when you name it as one, so "pay the
vehicle insurance" is *not* filed under Vehicle.

With no date said it lands **today** and the reply says so, so you hear the assumption
rather than discover it.

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
→ DueDo.

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

Voice capture — the dictation parser and the token endpoint behind it. Every rule in
`lib/dictation.ts` is a judgement about ambiguous English, and the only other way to
try one is to talk at a phone and see what happens, which tests one wording once. That
file imports nothing so Node runs the real one. The half that matters most is what it
refuses to guess: "pay the vehicle insurance" must **not** be filed under Vehicle, and
"end of the month" is a date while "end of every month" is a schedule. It also covers
what it must *not* leave in the title — "in five minutes" reached production sitting in
a reminder's name, due at the default time:

```bash
node --env-file=.env scripts/smoke-dictation.mjs
```

Plans and caps — the only suite that seeds *free* accounts on purpose, because it is
the one testing a paywall rather than a feature. Everything else spreads `PAID` from
`scripts/smoke-guard.mjs`, or it would start failing on billing it isn't about. The
assertion that matters most is §6: **a lapse never stops a reminder firing**, driven
through the real dispatcher, because a billing state that could silence an alert is
invisible from the outside until somebody misses their medication. It also covers the
door that doesn't go through the form — `POST /api/ingest/reminder` is a create path,
and a cap enforced only in the UI is not a cap:

```bash
node --env-file=.env scripts/smoke-plan.mjs
```

Unlike the audit suite this one uses a **real** sender rather than `fakeAuditMail=1`.
A faked send reports success without sending, and on a database that also carries real
rows the audit rotation then deletes a day of history no mail carried — that is not
hypothetical, it cost this install 7,156 rows of `cron.job_run_details` once. The price
is one renewal digest to the owner naming a test account.

They all seed throwaway accounts with **both channels switched off** and delete them
afterwards, so none of them ever emails or pushes anywhere. `smoke-dispatch`
additionally refuses to run while any device is subscribed to push, and every suite
refuses to run against a database holding real accounts (override with
`SMOKE_FORCE=1`). The two that empty a whole table — `smoke-audit-rotate` and
`smoke-run-history` — restore its rows afterwards regardless of that override, because
a guard you can switch off is a guard that will be switched off.

> **Never read the browser during render.** Every page here is a client component and
> is still server-rendered first, so `isPushSupported()` or `"PublicKeyCredential" in
> window` written straight into a component returns false on the server and true in the
> browser. React then throws the server's markup away and rebuilds that tree on the
> client — the page still looks right, which is exactly why this survived: the only
> evidence is a console error. Use `useClientOnly` from
> [`lib/client-only.ts`](lib/client-only.ts), which returns `null` until mounted so
> nothing has to guess.
>
> **Tip:** don't run `npm run build` while `npm run dev` is running — they share the
> `.next` folder and corrupt it. Stop dev first.
>
> Same for `prisma generate`: a running dev server holds the old client in memory, so a
> newly added column reads as undefined and writes fail in ways that look like a bug in
> whatever you were testing. Restart dev after regenerating.
