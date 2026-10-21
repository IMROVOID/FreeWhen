-- migrations/005_venue.sql
-- Idempotent and reversible. One concern. Named for what it creates.

create table if not exists venue (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references event(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 120),
  -- A venue is a PUBLIC place, so full precision is correct here. The
  -- two-decimal guarantee applies to `start_point` only.
  lat          numeric(9,6) not null,
  lng          numeric(9,6) not null,
  address      text,
  provider_place_id text,                 -- Neshan place id, for dedup and lookups
  price_level  smallint check (price_level between 1 and 4),
  -- NULL means UNKNOWN, never closed. Phase 3 TC-7 asserts absence ≠ closed.
  opening_hours jsonb,
  -- ★ The default must be `unknown` for all three attributes. A default of
  -- confirmed_yes would make every un-tagged venue silently accessible — the
  -- single most harmful possible bug (TC-11 depends on the source data
  -- being honest).
  accessibility jsonb not null default '{"stepFreeEntrance":"unknown",
                                          "accessibleRestroom":"unknown",
                                          "limitedWalkingSuitable":"unknown"}'::jsonb,
  parking      jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists venue_event_id_idx             on venue (event_id);
create index if not exists venue_event_provider_place_idx on venue (event_id, provider_place_id);
