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
-- `with schema extensions`, because without it pg_net is created in whatever schema
-- happens to be current — usually `public`, which Supabase's linter flags and which a
-- `prisma db push --force-reset` would drop along with the app's own tables. The
-- functions themselves always live in `net` regardless, which is why the cron command
-- below calls `net.http_post`.
create extension if not exists pg_net with schema extensions;

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

-- --------------------------------------------- keep pg_cron's own log from growing
-- pg_cron writes one row per run to cron.job_run_details and never removes any of
-- them. At one run a minute that is 1,440 rows a day, forever, whether or not anybody
-- uses the app. Measured on this install: 695 kB/day, 248 MB/year — already twice the
-- size of the entire application schema, and enough on its own to fill Supabase's
-- 500 MB free tier in about two years with no users at all.
--
-- Seven days holds it near 5 MB and still answers the only two questions that table
-- gets opened for: did the dispatcher run overnight, and when did it start failing.
select cron.unschedule('prune-cron-log')
where exists (select 1 from cron.job where jobname = 'prune-cron-log');

select cron.schedule(
  'prune-cron-log',
  '17 3 * * *', -- daily, off the hour so it never coincides with a dispatch tick
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);

-- The delete only marks tuples dead; autovacuum returns the space. To reclaim it
-- immediately after the first big prune:
--   vacuum (analyze) cron.job_run_details;

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
--   create extension if not exists pg_net with schema extensions;
--
-- Keep `with schema extensions`. pg_net reports `extrelocatable = false`, so ALTER
-- EXTENSION ... SET SCHEMA is refused afterwards — the schema is only choosable at
-- creation, and getting it wrong means living in `public` or repeating the
-- drop-and-recreate below. Its functions land in `net` either way, which is why the
-- cron command calls `net.http_post`.
--
-- To move an existing one out of `public`, drop and recreate in a single transaction so
-- no tick can land while net.http_post is absent:
--
--   begin;
--   drop extension pg_net;
--   create extension pg_net with schema extensions;
--   -- must return 1 before you commit; roll back if it doesn't
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'net' and p.proname = 'http_post';
--   commit;
--
-- This loses net._http_response, the log of what the app replied — a diagnostic
-- convenience, nothing the app reads.
--
-- Either way, note that `prisma db push --force-reset` drops the public schema; with
-- pg_net in `extensions` that no longer takes the extension with it.
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
