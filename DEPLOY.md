# PRO-SYS — Free Deployment Guide (Vercel + Supabase + Gmail)

PRO-SYS is a **single Next.js app** (UI + API together in `frontend/`). It deploys for **$0** as **one Vercel project**, with email reminders sent from your own Gmail.

## The stack

| Piece | Service | Cost |
|---|---|---|
| App (UI + API + cron) | Vercel (one project) | Free (Hobby) |
| Database (Postgres) | Supabase | Free |
| Email | Nodemailer + your Gmail App Password | Free (~500/day) |
| Daily reminder job | Vercel Cron | Free (1×/day) |

## Login

Family members log in by picking their name + a personal **PIN** (4–6 digits). The PIN is set on first login, or by an admin on the **Family** page. Everyone who's logged in sees all the family's reminders. Keep the app URL private.

---

## Prerequisites

1. Push this repo to **GitHub**.
2. A free **Vercel** account (sign in with GitHub).
3. A free **Supabase** project (or Neon — either works).
4. A **Gmail** account to send reminders from (optional but recommended).

---

## Step 1 — Database (Supabase)

1. Create a project at <https://supabase.com>.
2. In **Project Settings → Database → Connection string**, copy the **Transaction pooler** URI (port **6543**). URL-encode any `%` in the password as `%25`. Add `?sslmode=no-verify&pgbouncer=true`. This is your `DATABASE_URL`:
   ```
   postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=no-verify&pgbouncer=true
   ```
   > `sslmode=no-verify` is required — Supabase's pooler cert isn't in Node's default CA chain (the connection is still TLS-encrypted).

### Create the tables

From your machine, in `frontend/`:

```bash
cd frontend
cp .env.example .env          # paste your DATABASE_URL + set AUTH_SECRET
npm install
```

Then push the schema — **use the Session pooler (port 5432)**, because the transaction pooler (6543) can't do the advisory locks migrations need (it will hang):

```bash
npx prisma db push --url "postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=no-verify"
```

(Keep port **6543** in `.env`/Vercel for the running app; only schema pushes use 5432.)

---

## Step 2 — Gmail App Password (optional, for email)

1. Enable **2-Step Verification**: <https://myaccount.google.com/security>
2. Create an App Password: <https://myaccount.google.com/apppasswords> → copy the 16 characters.
3. These become `SMTP_USER` (your Gmail) and `SMTP_PASS` (the app password). Free Gmail allows ~500 recipients/day. Swap in Resend/Brevo SMTP later with no code change.

---

## Step 3 — Deploy to Vercel

1. Vercel → **Add New… → Project** → import your GitHub repo.
2. **Root Directory:** `frontend`.
3. Framework preset: **Next.js** (auto-detected).
4. Add **Environment Variables**:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | your Supabase **6543** pooler string (`sslmode=no-verify`) |
   | `AUTH_SECRET` | long random string (`openssl rand -base64 48`) |
   | `APP_NAME` | `PRO-SYS` |
   | `CRON_SECRET` | long random string |
   | `SMTP_HOST` | `smtp.gmail.com` *(optional)* |
   | `SMTP_PORT` | `465` |
   | `SMTP_SECURE` | `true` |
   | `SMTP_USER` | your Gmail address |
   | `SMTP_PASS` | your 16-char app password |
   | `MAIL_FROM` | `PRO-SYS <youraddress@gmail.com>` |

5. **Deploy.** Open the app URL. The first person to visit creates the first family member (admin) and their PIN.

The daily cron (`frontend/vercel.json` → `/api/cron/dispatch`) is picked up automatically; setting `CRON_SECRET` makes Vercel authenticate it.

---

## Step 4 — Verify

- Open the app → set up the first member → add family on the **Family** page (set their PINs, or let them set on first login).
- **Settings** page → send a test email.
- Add a reminder on **Reminders**; check the **Dashboard** and **Calendar**.

Manually trigger the daily job:
```bash
curl https://<your-app>.vercel.app/api/cron/dispatch -H "Authorization: Bearer <CRON_SECRET>"
```

---

## How reminders get sent

- **Automatic:** `frontend/vercel.json` runs `GET /api/cron/dispatch` daily (`30 3 * * *` = 09:00 IST; Vercel Cron is UTC, free Hobby = once/day). Each reminder is emailed **once, when it's due** (or the first run on/after its due date) — never day after day. Recurring reminders re-arm after completion.
- **On demand:** the **"Notify family"** button on a reminder emails every family member about it immediately.

---

## Security note

There is a login, but **anyone with your app URL sees the family login screen**, and PINs are short. Keep the URL private. For extra protection you can enable Vercel Deployment Protection on the project.

---

## Local development

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

Trigger the reminder job locally (no CRON_SECRET needed in dev):
```bash
curl http://localhost:3000/api/cron/dispatch
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `prisma db push` hangs | Use the **Session pooler (5432)**, not 6543. |
| `self-signed certificate` DB error | Add `sslmode=no-verify` to `DATABASE_URL`. |
| Login says "Incorrect PIN" for everyone | `AUTH_SECRET` must be set and stable. Reset a member's PIN on the Family page. |
| Emails not arriving | Check spam; verify `SMTP_*`; Gmail needs 2FA + App Password. Use Settings → test email. |
| `CRON_SECRET is not configured` | Set `CRON_SECRET` in Vercel env. |
