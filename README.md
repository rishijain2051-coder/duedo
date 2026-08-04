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
hand out; entering it raises a request the head approves — knowing the code alone
never puts anyone on a shared list.

Reminders live in one of two places, chosen when you create them: **Mine**
(private) or a family's shared list. Each family reminder can be **assigned** to a
member, and picks who gets alerted:

| Notify | Who hears about it |
| --- | --- |
| Only me | The creator |
| The assigned member | The assignee, falling back to the creator |
| Everyone in the family | Every member |

Any member can **complete or snooze** something on the shared list — that's what
makes it shared. Editing, reassigning and changing the audience stay with the
creator and the head, because those change the thing for everyone.

The head can rename the family, rotate the join code, approve or remove members,
hand over headship, and dissolve it. **Dissolving is refused while any reminder is
still on the shared list** — clear them first, so it can never destroy work as a
side effect. A head must hand over before leaving, so a family is never left with
nobody able to administer it.

## Accounts: approval and privacy

Everyone gets their own account, and your personal reminders are **not visible to
other users**.

An **administrator of the install can view any account's reminders** for support,
and every such view is written to the audit log. That's a deliberate trade of
privacy for debuggability — worth knowing, since the app says so in Settings rather
than promising something it doesn't deliver.

- **Signing up** is self-service: name, email, and a 4-digit PIN.
- **An admin must approve** a new account before it can sign in. Until then it sits
  as `pending`.
- The **first account on a fresh install** is auto-approved and becomes the admin —
  otherwise there would be nobody to approve anyone. So register right after your
  first deploy.
- Admins work in the **`/admin` panel**, not Settings:
  - **Accounts** — the approval queue, search, roles, PIN resets for people locked
    out, and a reminder viewer.
  - **Families** — every household on the install; rename, appoint a head, remove
    members, dissolve.
  - **Health** — whether SMTP, VAPID and `CRON_SECRET` are actually set, the last
    few dispatch runs with counts, and devices failing to receive. A broken
    dispatcher and an idle one both send nothing; the run history is what tells
    them apart.
  - **Audit log** — approvals, role changes, deletions, family membership changes,
    and every admin read of someone else's reminders.
- An admin can't act on their own row, which is what stops the last admin locking
  everybody out — and is why no "is this the last admin?" counting exists anywhere.

## Login

**Email + PIN.** A **passkey** (Face ID / Touch ID / Windows Hello) can be added
from **Settings → Security**; the PIN stays as the fallback so a lost passkey never
locks you out. Passkeys are discoverable credentials, so the lock screen doesn't
need to be told who you are first — and the login page never reveals who has an
account here.

Sessions are stored in the database, so **Settings → Security** can list every
active login and sign any of them out, and an optional inactivity timeout is
enforced server-side rather than merely honoured by the browser.

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

With the dev server running, these check the three things that break quietly.

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

Route contracts — the edges nobody exercises by hand. Every protected route refuses
an anonymous caller with 401; every method a route doesn't declare answers 405; a
malformed body is a 400 rather than a 500; an unknown id is a 404 rather than a
crash; every query parameter can be given rubbish. A 500 is the interesting failure
here — it means a bad request reached code that assumed a good one:

```bash
node --env-file=.env scripts/smoke-routes.mjs
```

All three seed throwaway accounts with **both channels switched off** and delete them
afterwards, so none of them ever emails or pushes anywhere. `smoke-dispatch`
additionally refuses to run while any device is subscribed to push, and all three
refuse to run against a database holding real accounts (override either with
`SMOKE_FORCE=1`).

> **Tip:** don't run `npm run build` while `npm run dev` is running — they share the
> `.next` folder and corrupt it. Stop dev first.
