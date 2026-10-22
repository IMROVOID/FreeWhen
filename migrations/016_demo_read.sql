-- migrations/016_demo_read.sql
-- Idempotent and reversible. One concern. Named for what it creates.
--
-- ★ THE REVIEWER MUST SEE THE RANKING WITHOUT SIGNING IN.
--
-- Every anonymous sign-in costs one request from a 30/hour/IP budget
-- (PRD-10 D3, R-12). A reviewer who reloads the demo four times has spent
-- four of them before deciding anything, and a room full of reviewers behind
-- one NAT address exhausts the budget in minutes. So the demo event is
-- readable by the `anon` role — and ONLY the demo event.
--
-- ★ `is_demo` IS THE ENTIRE SAFETY OF THE DEFINER FUNCTION BELOW.
--
-- `demo_event_summary()` runs as its definer and therefore bypasses RLS. The
-- `e.is_demo is true` predicate is what stops it reading a real event. Do NOT
-- widen this to a status check (`e.status = 'DECIDING'`) or to any condition
-- the event's own organizer controls — an organizer could then make their real
-- event anonymous-readable. `tests/deploy/demo-read.test.ts` asserts that a
-- non-demo event returns null for an anonymous caller.

-- ─────────────────────────────────────────────────────────────
-- 1. The demo marker
-- ─────────────────────────────────────────────────────────────
--
-- Default `false`, so no existing row changes meaning. An event becomes a demo
-- only by an explicit update, which is the property the predicate depends on.
alter table event
  add column if not exists is_demo boolean not null default false;

-- At most one demo event, so the landing page has one stable target and the
-- anonymous read budget cannot be spread across a fleet of them. A partial
-- unique index on a constant expression is the portable way to say "one row
-- where is_demo is true".
create unique index if not exists event_single_demo_idx
  on event ((true))
  where is_demo is true;

-- ─────────────────────────────────────────────────────────────
-- 2. The anonymous read
-- ─────────────────────────────────────────────────────────────
--
-- The projection is deliberately narrow:
--
--   * `- 'invite_token_hash'` — the hash of a live invite link is a credential.
--   * `'participants'` is a COUNT, never rows: a demo readable by strangers
--     must not expose who is in the event (PRD-08 FR-8.19).
--   * NO `start_point` at all — `lat_rounded`/`lng_rounded` are the
--     participants' approximate areas, and a public read must not turn a
--     fuzzed location into a leak. This is the one fact the ranked venue list
--     does not need.
--   * `venue` rows carry no participant data, so they pass through whole.
create or replace function public.demo_event_summary(p_event_id uuid)
returns jsonb
language sql
stable
security definer
-- ★ `pg_temp` LAST, like every other definer in this schema.
--
-- A definer body is re-parsed on every call, unlike a policy expression, so a
-- caller's temp table could otherwise shadow a real relation. Listing the real
-- schema first and `pg_temp` last closes that. `tests/db/rls.test.ts` asserts
-- this for every definer function, which is why it is not optional.
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'event', jsonb_build_object(
      'id',                e.id,
      'title',             e.title,
      'description',       e.description,
      'activity_type',     e.activity_type,
      'date_window_start', e.date_window_start,
      'date_window_end',   e.date_window_end,
      'home_tz',           e.home_tz,
      'voting_deadline',   e.voting_deadline,
      'status',            e.status,
      'is_demo',           e.is_demo
    ),
    'participantCount', (
      select count(*) from participant p where p.event_id = e.id
    ),
    'venues', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id',                  v.id,
                 'name',                v.name,
                 'lat',                 v.lat,
                 'lng',                 v.lng,
                 'address',             v.address,
                 'priceLevel',          v.price_level,
                 'openingHours',        v.opening_hours,
                 'accessibility',       v.accessibility,
                 'parking',             v.parking
               )
               order by v.name
             )
      from venue v where v.event_id = e.id
    ), '[]'::jsonb),
    'tally', coalesce((
      select jsonb_object_agg(p.status, p.n)
      from (
        select pr.status, count(*) as n
        from proposal pr
        where pr.event_id = e.id
        group by pr.status
      ) p
    ), '{}'::jsonb)
  )
  from event e
  where e.id = p_event_id
    and e.is_demo is true;          -- ← the only thing making this safe
$$;

-- The service role reads every event through the normal RLS-scoped paths, so
-- it does not need this function; `anon` is the whole point of it.
grant execute on function public.demo_event_summary(uuid) to anon;

-- ─────────────────────────────────────────────────────────────
-- 3. Reversal
-- ─────────────────────────────────────────────────────────────
--
--   revoke execute on function public.demo_event_summary(uuid) from anon;
--   drop function if exists public.demo_event_summary(uuid);
--   drop index if exists event_single_demo_idx;
--   alter table event drop column if exists is_demo;
