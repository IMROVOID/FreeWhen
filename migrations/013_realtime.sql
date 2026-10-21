-- migrations/013_realtime.sql
-- Idempotent and reversible. One concern. Named for what it creates.
--
-- ★ Deliberately EXCLUDED: start_point, travel_measurement, activity_log.
-- Broadcasting a location change to every event participant over a websocket
-- is a privacy leak, and travel_measurement is a high-churn cache that would
-- flood the channel. Do not add them.
--
-- The five published tables are exactly PRD-09 §3.5: vote, proposal, rsvp,
-- event, event_message.

-- The publication exists on Supabase. On plain Postgres it may not, and the
-- local backend's realtime bridge listens on its own channel (PRD-09 §4.0.1),
-- so the publication is created here if it is absent and left alone if it
-- is present.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;
end
$$;

-- `alter publication ... add table` fails when the table is already a
-- member, so membership is checked first. This keeps the migration
-- re-runnable, which AC-9.7.1 requires.
do $$
declare
  t text;
begin
  foreach t in array array['vote','proposal','rsvp','event','event_message'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
