# PRO-SYS — Free Deployment Guide (Vercel + Supabase + Gmail)

PRO-SYS is a **single Next.js app** (UI + API in one repo). It deploys for **$0** as **one Vercel project**, with email reminders sent from your own Gmail.

## The stack

| Piece | Service | Cost |
|---|---|---|
| App (UI + API + cron) | Vercel (one project) | Free (Hobby) |
| Database (Postgres) | Supabase | Free |
| Email | Nodemailer + your Gmail App Password | Free (~500/day) |
| Daily reminder job | Vercel Cron | Free (1×/day) |

## Login

Family members log in by picking their name + a personal **PIN** (4–6 digits), set on first login or by an admin on the **Family** page. Everyone logged in sees all reminders. Keep the app URL private.

---

## Prerequisites

1. Push this repo to **GitHub** (the whole repo is the app — no subfolder).
2. Free **Vercel** account.
3. Free **Supabase** project.
4. A **Gmail** account to send reminders from.

---

## Step 1 — Database (Supabase)

1. Create a project at <https://supabase.com>.
2. **Project Settings → Database → Connection string** → copy the **Transaction pooler** URI (port **6543**). URL-encode any `%` in the password as `%25`, and add `?sslmode=no-verify&pgbouncer=true`. This is your `DATABASE_URL`:
   ```
   postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=no-verify&pgbouncer=true
   ```
   > `sslmode=no-verify` is required — Supabase's pooler cert isn't in Node's default CA chain (still TLS-encrypted).

### Create the tables (run locally, once)

```bash
cp .env.example .env          # paste your DATABASE_URL + set AUTH_SECRET
npm install
```

Push the schema using the **Session pooler (port 5432)** — the transaction pooler (6543) hangs on the advisory locks migrations need:

```bash
npx prisma db push --url "postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=no-verify"
```

(Keep port **6543** in `.env`/Vercel for the running app; only schema pushes use 5432.)

---

## Step 2 — Gmail App Password (for email)

1. Enable **2-Step Verification**: <https://myaccount.google.com/security>
2. Create an App Password: <https://myaccount.google.com/apppasswords> → copy the 16 characters (spaces don't matter).
3. `SMTP_USER` = your Gmail, `SMTP_PASS` = the app password. ~500 recipients/day.

---

## Step 3 — Deploy to Vercel

1. Vercel → **Add New… → Project** → import your GitHub repo.
2. **Root Directory: leave as the repo root** (the app is at the top level — do *not* set a subfolder).
3. Framework: **Next.js** (auto-detected).
4. Add **Environment Variables**:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | Supabase **6543** pooler string (`sslmode=no-verify`) |
   | `AUTH_SECRET` | long random string |
   | `APP_NAME` | `PRO-SYS` |
   | `CRON_SECRET` | long random string |
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `465` |
   | `SMTP_SECURE` | `true` |
   | `SMTP_USER` | your Gmail address |
   | `SMTP_PASS` | your 16-char app password |
   | `MAIL_FROM` | `PRO-SYS <youraddress@gmail.com>` |

5. **Deploy.** Open the URL; the first visitor creates the first member (admin) + PIN.

The daily cron (`vercel.json` → `/api/cron/dispatch`) is picked up automatically; `CRON_SECRET` authenticates it.

---

## How reminders get sent

- **Automatic:** `vercel.json` runs `GET /api/cron/dispatch` daily (`30 3 * * *` = 09:00 IST; Vercel Cron is UTC, free Hobby = once/day). Each reminder is emailed **once, when it's due** (or the first run on/after its due date) — never day after day. Recurring reminders re-arm after completion.
- **On demand:** the **"Notify family"** button on a reminder emails every family member about it immediately.

---

## Local development

```bash
npm install
npm run dev        # http://localhost:3000
```

Trigger the reminder job locally:
```bash
curl http://localhost:3000/api/cron/dispatch -H "Authorization: Bearer <CRON_SECRET>"
```

> Don't run `npm run build` while `npm run dev` is running (they share `.next`). Stop dev first.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `prisma db push` hangs | Use the **Session pooler (5432)**, not 6543. |
| `self-signed certificate` DB error | Add `sslmode=no-verify` to `DATABASE_URL`. |
| Build error `Cannot find module for page: /_document` | You ran `next build` while `next dev` was running. Stop dev, delete `.next`, rebuild. (Doesn't affect Vercel.) |
| Emails not arriving | Check spam; verify `SMTP_*`; Gmail needs 2FA + App Password. Use Settings → test email. |
| Login "Incorrect PIN" for everyone | `AUTH_SECRET` must be set and stable. Reset a member's PIN on the Family page. |
