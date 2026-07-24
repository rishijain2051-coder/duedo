# PRO-SYS

Life Reminder Management System — a "Life ERP" that helps a family remember and manage every recurring responsibility from one place.

## Architecture

A **single Next.js 15 app** (`frontend/`) containing both the UI and the API:

- **UI** — React 19, TypeScript, Tailwind CSS (App Router pages).
- **API** — Next.js Route Handlers under `frontend/app/api/*` (family members, categories, reminders, reports, notifications).
- **Database** — PostgreSQL via Prisma 7 (Supabase).
- **Email** — Nodemailer over your own SMTP account (e.g. Gmail app password).

Because the UI and API share one origin, there's one server, one deploy, and no CORS/API-URL juggling.

## Login (family PINs)

Each family member logs in by **picking their name and entering a personal PIN** (set on first login, or by an admin on the Family page). A signed httpOnly cookie keeps them in. Once logged in, **everyone sees all the family's reminders**. The first person to open a fresh install creates the first member (becomes admin).

## Email reminders

- **Automatic:** a daily job (Vercel Cron → `GET /api/cron/dispatch`, protected by `CRON_SECRET`) emails a reminder **once, on its due date** — no daily repeats. Recurring reminders re-arm after completion.
- **On demand:** the **"Notify family"** button on any reminder emails the whole family about it immediately.

Engine: `frontend/lib/dispatch.ts` + `frontend/lib/mail.ts`.

## Deployment (free)

One Vercel project + Supabase (free) + your Gmail. See **[DEPLOY.md](DEPLOY.md)**.

## Local development

```bash
cd frontend
npm install
cp .env.example .env    # fill in DATABASE_URL, AUTH_SECRET (email optional)
npm run dev             # http://localhost:3000
```

If the database schema is empty, create the tables first (see DEPLOY.md — use Supabase's session pooler on port 5432 for `prisma db push`).

See `PRO-SYS_SRS_v2_Comprehensive.md` for the full product spec.
