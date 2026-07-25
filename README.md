# PRO-SYS

A simple reminder app for the whole family — never miss a bill, birthday, renewal, or anything else that's due.

## Architecture

A **single Next.js 15 app** (this repo) containing both the UI and the API:

- **UI** — React 19, TypeScript, Tailwind CSS (App Router pages).
- **API** — Next.js Route Handlers under `app/api/*` (family members, categories, reminders, reports, notifications).
- **Database** — PostgreSQL via Prisma 7 (Supabase).
- **Email** — Nodemailer over your own SMTP account (Gmail app password).

One origin → one server, one deploy, no CORS.

## Login (family PINs)

Each family member logs in by picking their name and entering a personal **PIN** (set on first login, or by an admin on the Family page). A signed httpOnly cookie keeps them in. Once logged in, **everyone sees all the family's reminders**. The first person to open a fresh install creates the first member (admin).

## Email reminders

- **Automatic:** a daily job (Vercel Cron → `GET /api/cron/dispatch`, protected by `CRON_SECRET`) emails a reminder **once, on its due date** — no daily repeats. Recurring reminders re-arm after completion.
- **On demand:** the **"Notify family"** button on any reminder emails the whole family about it immediately.

Engine: `lib/dispatch.ts` + `lib/mail.ts`.

## Deployment (free)

One Vercel project (Root Directory = repo root) + Supabase (free) + your Gmail. See **[DEPLOY.md](DEPLOY.md)**.

## Local development

```bash
npm install
cp .env.example .env    # fill in DATABASE_URL, AUTH_SECRET (email optional)
npm run dev             # http://localhost:3000
```

If the database is empty, create the tables first (see DEPLOY.md — use Supabase's **session pooler (port 5432)** for `prisma db push`).

> **Tip:** don't run `npm run build` while `npm run dev` is running — they share the `.next` folder and corrupt it. Stop dev first.
