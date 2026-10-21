-- migrations/014_jobs.sql
-- Idempotent and reversible. One concern. Named for what it creates.
--
-- ★ NEITHER BACKEND PROVIDES AUTOMATIC CLEANUP OF ANONYMOUS USERS.
-- Without this job the database grows forever, and abandoned location data
-- outlives its purpose (PRD-08 FR-8.24).
--
-- ★ The retention job runs AT EVENT END, NOT AT CONFIRMATION (OQ-8.2).
-- Deleting at confirmation breaks the leave-now reminder, which needs the
-- travel estimate on the day.
--
-- The two jobs are plain SQL functions so they are callable from a cron on
-- either backend. The schedule is registered with pg_cron where that
-- extension exists (Supabase); on plain Postgres the server's scheduler calls
-- the same functions, so the SQL is identical on both.

-- ─────────────────────────────────────────────────────────────
-- 1. The run log
-- ─────────────────────────────────────────────────────────────
create table if not exists job_log (
  id          bigserial primary key,
  job_name    text not null,
  ran_at      timestamptz not null default now(),
  rows_affected integer not null default 0
);

create index if not exists job_log_job_name_ran_at_idx on job_log (job_name, ran_at desc);

-- The log is server-written and read by no client. Deny by default, like
-- every other table.
alter table job_log enable row level security;
grant select, insert, update, delete on job_log to service_role;

-- ─────────────────────────────────────────────────────────────
-- 2. The retention job
-- ─────────────────────────────────────────────────────────────
create or replace function run_retention_job()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  -- Coordinates of events that are over. The one-hour grace period keeps a
  -- job that fires a moment after the window closes from racing a client
  -- that is still reading.
  delete from start_point sp
  using participant p, event e
  where sp.participant_id = p.id
    and p.event_id = e.id
    and e.date_window_end < now() - interval '1 hour';

  get diagnostics v_deleted = row_count;

  insert into job_log (job_name, rows_affected) values ('retention', v_deleted);

  return v_deleted;
end;
$$;

revoke all on function run_retention_job() from public;
grant execute on function run_retention_job() to service_role;

-- ─────────────────────────────────────────────────────────────
-- 3. The anonymous-user cleanup job
-- ─────────────────────────────────────────────────────────────
create or replace function run_anon_cleanup_job()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  -- auth.users carries the same is_anonymous / created_at columns on both
  -- backends (Supabase ships the table; migration 000 creates it on plain
  -- Postgres), so this statement is portable as written.
  --
  -- ★ USERS WHO STILL OWN A LIVE EVENT ARE EXEMPT.
  --
  -- vent.created_by is ON DELETE CASCADE, so deleting an anonymous
  -- organizer takes the event, its participants, its proposals, its votes
  -- and its start points with it. A 30-day-old account that is still
  -- running a future event would therefore lose the whole event.
  --
  -- The exemption is "owns an event whose window has not closed yet". An
  -- event that has ended may still be deleted along with its organizer --
  -- the 30-day window has already passed for that account, and the
  -- retention job has removed the coordinates.
  delete from auth.users u
  where u.is_anonymous is true
    and u.created_at < now() - interval '30 days'
    and not exists (
      select 1
      from public.event e
      where e.created_by = u.id
        and e.date_window_end >= now()
    );

  get diagnostics v_deleted = row_count;

  insert into job_log (job_name, rows_affected) values ('anon_cleanup', v_deleted);

  return v_deleted;
end;
$$;

revoke all on function run_anon_cleanup_job() from public;
grant execute on function run_anon_cleanup_job() to service_role;

-- ─────────────────────────────────────────────────────────────
-- 4. The schedule
-- ─────────────────────────────────────────────────────────────
-- pg_cron is the Supabase scheduler. It is not available on plain Postgres
-- and not available on every managed host, so the schedule is registered
-- only when the extension can be created — and the functions above remain
-- callable by an external scheduler either way.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    null;
  end;
end
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'freewhen-retention') then
      perform cron.schedule('freewhen-retention', '17 * * * *', 'select run_retention_job()');
    end if;

    if not exists (select 1 from cron.job where jobname = 'freewhen-anon-cleanup') then
      perform cron.schedule('freewhen-anon-cleanup', '23 4 * * *', 'select run_anon_cleanup_job()');
    end if;
  end if;
end
$$;

