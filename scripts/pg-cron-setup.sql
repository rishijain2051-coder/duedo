-- PRO-SYS — per-minute reminder dispatch via Supabase pg_cron.
--
-- Run this ONCE in the Supabase SQL editor (Dashboard -> SQL Editor -> New query)
-- after the app is deployed and you know its URL.
--
-- Why not Vercel Cron? On the free Hobby plan a cron job may only run once a DAY,
-- which cannot drive time-based reminders (lead alerts, a due-time alert, and
-- overdue nagging all need minute granularity). Postgres schedules this itself, at
-- no cost, and pg_net makes the outbound HTTP call.
--
-- One call covers every account: /api/cron/dispatch walks all approved users.
--
-- The domain below is already set. Replace the one remaining placeholder:
--   YOUR_CRON_SECRET -> the CRON_SECRET from your Vercel environment variables
--
-- The secret is deliberately NOT stored in this file, because this file is tracked
-- by git. It does end up inside cron.job.command in the database once scheduled,
-- which is unavoidable with pg_net and is why CRON_SECRET should be treated as a
-- shared secret between Supabase and Vercel rather than a user credential.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-running is safe: drop any previous schedule first.
select cron.unschedule('prosys-dispatch')
where exists (select 1 from cron.job where jobname = 'prosys-dispatch');

select cron.schedule(
  'prosys-dispatch',
  '* * * * *', -- every minute; this is pg_cron's finest granularity
  $$
  select net.http_post(
    url     := 'https://pro-sys-by-rishi.vercel.app/api/cron/dispatch',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer YOUR_CRON_SECRET'
    ),
    body    := '{}'::jsonb,
    -- Comfortably inside the route's 60s maxDuration.
    timeout_milliseconds := 20000
  );
  $$
);

-- ------------------------------------------------------- if reminders go silent
-- The failure this has actually hit: `pg_net` disappearing from the database. The
-- job keeps firing every minute and fails instantly with
--
--   ERROR:  schema "net" does not exist
--
-- Nothing in the app can report that, because the dispatcher is never reached and so
-- records no run — the only symptom is a stale "last ran" on the admin health page.
-- That page now checks for the extension by name and says so; if it ever reads
-- "missing", this is the whole fix:
--
--   create extension if not exists pg_net;
--
-- pg_net is not relocatable (`extrelocatable = false`), so it stays associated with
-- whichever schema it was created in, and its functions always live in `net`. Note
-- that `prisma db push --force-reset` drops the public schema and would take it with
-- it; an ordinary `prisma db push` does not.
--
-- ---------------------------------------------------------------- verification
-- Confirm the job is registered:
--   select jobid, jobname, schedule, active from cron.job;
--
-- Watch the last few runs (this shows whether Postgres fired the job, not what
-- the app replied):
--   select runid, status, return_message, start_time
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'prosys-dispatch')
--   order by start_time desc
--   limit 20;
--
-- Inspect the HTTP responses the app actually returned:
--   select id, status_code, content, created
--   from net._http_response
--   order by created desc
--   limit 20;
--
-- A 200 with "fired":{"lead":0,"due":0,"overdue":0} is the normal idle result —
-- it means the engine ran and had nothing to send.
--
-- ------------------------------------------------------------------- teardown
--   select cron.unschedule('prosys-dispatch');
