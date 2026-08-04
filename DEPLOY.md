# Deploying PRO-SYS (free tier)

One Vercel project + one Supabase project. Email and push are both optional — set up
either, both, or neither, and each person picks what they want in Settings.

Order matters in one place only: **register the first account immediately after the
first deploy** (see step 6).

---

## 1. Supabase: create the database

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. **Project Settings → Database → Connection string → URI.** You need *two* forms
   of it, and they are not interchangeable:

   | Use | Port | Why |
   | --- | --- | --- |
   | The app at runtime (`DATABASE_URL`) | **6543** — Transaction pooler | Serverless functions open a connection per invocation; the pooler is what stops that exhausting Postgres. |
   | `prisma db push` (schema changes) | **5432** — Session pooler | DDL needs a real session. The transaction pooler will fail or hang on it. |

3. Append `?sslmode=no-verify&pgbouncer=true` to the runtime URL. Supabase's pooler
   certificate isn't in Node's default CA chain, so the connection is encrypted but
   the chain isn't verified.
4. **URL-encode reserved characters in the password**: `#` → `%23`, `&` → `%26`,
   `%` → `%25`, `@` → `%40`. A raw `#` silently truncates the URL and produces a
   baffling "database does not exist" — check that one first if things go wrong.

## 2. Create the tables

From your machine, with `DATABASE_URL` in `.env` pointed at the **session pooler
(5432)**:

```bash
npx prisma db push
```

This is a fresh schema with no migration history — it creates everything from
`prisma/schema.prisma`. Re-running it later applies changes in place.

> Switch `DATABASE_URL` back to the **transaction pooler (6543)** for the value you
> put into Vercel.

## 3. Generate the secrets

```bash
openssl rand -base64 48
```

Run it twice — once for `AUTH_SECRET`, once for `CRON_SECRET`. For push:

```bash
npx web-push generate-vapid-keys
```

## 4. Email (optional)

Any SMTP account works. With Gmail: enable 2-Step Verification, then create a
16-character **App Password** at
[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) and
use that as `SMTP_PASS` — not your account password.

Everyone's reminder emails are sent *from* this one account, to each user's own
address.

## 5. Vercel: deploy

Import the repo, leave **Root Directory** at the repo root, and add the environment
variables from [`.env.example`](.env.example):

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Transaction pooler (6543). |
| `AUTH_SECRET` | yes | Changing it signs everyone out. |
| `CRON_SECRET` | yes | Without it the cron endpoint refuses to run in production. |
| `APP_NAME` | no | Defaults to `PRO-SYS`. |
| `APP_URL` | no | Adds an "Open PRO-SYS" button to reminder emails. |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | for email | Leave blank to disable email entirely. |
| `VAPID_PUBLIC_KEY` `VAPID_PRIVATE_KEY` `NEXT_PUBLIC_VAPID_PUBLIC_KEY` `VAPID_SUBJECT` | for push | The public key goes in twice — once server-side, once as `NEXT_PUBLIC_*`. |

`npm run build` runs `prisma generate` first, so no extra build step is needed.

## 6. Register the admin — do this first

Open the deployed URL. Because the database is empty the login page offers **Set up
the first account**, and that account is **auto-approved as the admin**.

This is a real window: until you register, anyone who reaches the URL could claim
the admin account. Do it immediately after the deploy finishes.

Everyone else signs up the same way afterwards and activates their own account by
clicking the link in the confirmation email — no approval needed from you. That
depends on SMTP working, which is why step 3 matters; if mail is unavailable the
signup response says so and you can activate the account by hand under
**/admin → Accounts**.

## 7. Schedule the dispatcher (every minute)

The engine needs minute granularity — lead alerts, the due-time alert and overdue
nagging all depend on it. **Vercel's free Hobby plan only allows one cron run per
day**, which cannot drive this, so scheduling lives entirely in Supabase.

There is deliberately **no `vercel.json`** and no Vercel cron. Don't add one: a daily
tick would fire due and overdue alerts roughly a day late and miss most lead alerts
altogether, which is worse than not having it, because it looks like it works.

Open the Supabase **SQL Editor** and run
[`scripts/pg-cron-setup.sql`](scripts/pg-cron-setup.sql), replacing the two
placeholders with your deployed domain and your `CRON_SECRET`. One call covers every
account.

Verify:

```sql
select jobid, jobname, schedule, active from cron.job;
```

```sql
select id, status_code, content, created from net._http_response order by created desc limit 10;
```

A `200` with `"fired":{"lead":0,"due":0,"overdue":0}` is the normal idle result — the
engine ran and had nothing to send.

If this job isn't scheduled, nothing is ever sent — no other timer exists. The app
itself will look completely healthy, because creating and listing reminders doesn't
depend on it.

## 8. Turn on notifications

**On iPhone this only works from the Home Screen.** iOS refuses web push in a Safari
tab. Open the app in Safari → **Share** → **Add to Home Screen**, launch it from the
new icon, then tap **Allow notifications** on the banner (or Settings → How you're
reminded). Requires iOS 16.4+.

Each person does this on their own devices. A device belongs to whoever is signed in
when notifications are enabled; if someone else signs in on that same browser, the
device is handed over to them, because otherwise they'd receive each other's private
reminders.

Use **Send test push** and **Send test email** in Settings to confirm both ends.

---

## Troubleshooting

**"Not authenticated" straight after signing in.** `AUTH_SECRET` differs between
builds, or the browser is blocking the cookie. The cookie is `httpOnly`,
`SameSite=Lax` and `Secure` in production — so it needs HTTPS.

**Login says to confirm the email address.** Working as intended — the link in the
confirmation email is what activates the account, and the login screen offers to
send another. If it never arrives, check that SMTP is configured (**/admin → Health**
says), then activate the account by hand under **/admin → Accounts**. On a fresh
install with no accounts at all,
the login page offers signup instead.

**No push on iPhone.** Almost always a Safari tab rather than an installed app. Check
Settings → How you're reminded: if it says *Add PRO-SYS to your Home Screen first*,
that's the cause.

**Push worked, then stopped.** iOS rotates subscriptions. The app re-registers on
every load and the service worker handles `pushsubscriptionchange`, so opening the
app usually repairs it. Settings → Your devices shows failure counts per device.

**No email.** Check `SMTP_*` and that the account has email switched on in Settings.
Gmail rejects a normal password — it must be an App Password. **Send test email**
surfaces the server's actual error.

**Emails feel too rare while something is overdue.** By design: overdue emails are
capped at one every 12 hours. Push carries the frequent nagging.

**`prisma db push` hangs.** You're on the transaction pooler (6543). DDL needs the
session pooler (5432).

**Cron returns 401.** `CRON_SECRET` doesn't match the `Authorization: Bearer …`
header in the SQL, or isn't set in Vercel at all.
