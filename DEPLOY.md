# Deploying PRO-SYS (free tier)

One Vercel project + one Supabase project. Email and push are both optional — set up
either, both, or neither, and each person picks what they want in Settings.

Nothing here is time-critical: no account is ever granted admin automatically, so
there is no window to race. You promote your own account once, by hand (step 6).

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
| `NEXT_PUBLIC_UPGRADE_WHATSAPP` | for paid plans | Digits only, full international form: `919876543210`. Without it (and without `NEXT_PUBLIC_UPGRADE_EMAIL`) `/upgrade` still lists the plans but offers no way to ask for one. |

`npm run build` runs `prisma generate` first, so no extra build step is needed.

## 6. Make yourself the admin

Sign up on the deployed URL like anyone else, then confirm the address from the email.
That gives you an ordinary active account. Promote it once, in the Supabase SQL editor:

```sql
update "User"
   set role = 'admin', status = 'active', "isRootAdmin" = true
 where email = 'you@example.com';
```

`isRootAdmin` marks the install's owner. It is the one row no other admin can demote,
reject, delete or reset the PIN of — so an admin you promote later can never lock you
out, and you can hand ownership over deliberately from **/admin → Accounts** if you
ever want to.

There is no "first account becomes the admin" shortcut, on purpose. It saved exactly
this one statement, and the price was that on an empty database whoever POSTed the
signup route first got admin.

Everyone else signs up the same way and activates their own account by clicking the
link in the confirmation email — no approval needed from you. That depends on SMTP
working, which is why step 3 matters; if mail is unavailable the signup response says
so and you can activate the account by hand under **/admin → Accounts**.

## 6a. Give yourself a plan

Your own account signs up on Free like everybody else, which means no email reminders,
no spending tracker, no voice capture and no creating a family. Fix that once, from
**/admin → Accounts → Plan** on your own row: pick Family, pick 1 year, Grant.

That control is the whole payment system. Somebody messages you from `/upgrade`, pays
however suits, and you set the date. Only the root admin sees it — an admin you promote
later cannot hand out paid access, to themselves or to anyone.

Grants **stack** from the later of today and the current expiry, so renewing three days
early keeps those three days and renewing a month late starts from today rather than
back-dating. The note field is for your own reconciliation ("UPI ref 4471, ₹99, 1yr");
the account it describes never sees it.

Three days before anyone's access ends, the dispatcher tells them in the app and mails
you a list of who to chase. Nothing of theirs is deleted or switched off when it lapses:
every reminder they have keeps firing, and they simply can't add new ones until they are
back under the free cap.

## 7. Schedule the dispatcher (every minute)

The engine needs minute granularity — lead alerts, the due-time alert and overdue
nagging all depend on it. **Vercel's free Hobby plan only allows one cron run per
day**, which cannot drive this, so scheduling lives entirely in Supabase.

`vercel.json` exists only to pin the function region (see [SCALE.md](SCALE.md)) and
declares **no crons**. Don't add one: a daily tick would fire due and overdue alerts
roughly a day late and miss most lead alerts altogether, which is worse than not
having it, because it looks like it works.

Open the Supabase **SQL Editor** and run
[`scripts/pg-cron-setup.sql`](scripts/pg-cron-setup.sql), replacing the two
placeholders with your deployed domain and your `CRON_SECRET`. One call covers every
account.

That script schedules one job, `prosys-dispatch`, every minute.

Nothing else to schedule: pg_cron's own run log — one row per run, never removed by
pg_cron, measured at 248 MB a year here — is rotated by the app on the same terms as
its audit log, mailed to the owner daily and then trimmed to 24 hours. See
[SCALE.md](SCALE.md).

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
says), then activate the account by hand under **/admin → Accounts** — or, on a fresh
install with no admin yet, with the SQL in step 6.

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
