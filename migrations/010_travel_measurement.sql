-- migrations/010_travel_measurement.sql
-- Idempotent and reversible. One concern. Named for what it creates.

create table if not exists travel_measurement (
  id            bigserial primary key,
  -- The origin is snapped to ~200 m (numeric(5,2)) so that the cache is
  -- shared across participants who live near each other.
  origin_lat    numeric(5,2) not null,
  origin_lng    numeric(5,2) not null,
  dest_lat      numeric(7,5) not null,
  dest_lng      numeric(7,5) not null,
  mode          text not null check (mode in ('car','transit','walk','cycle','taxi')),
  departure_bucket timestamptz not null,  -- 15-min bucket
  minutes       integer not null,
  minutes_high  integer,                  -- for range display at low confidence
  distance_m    integer not null,
  transfers     smallint,
  walk_minutes  smallint,
  wait_minutes  smallint,
  -- ★ NULL means UNKNOWN, never free. A default of 0 would make every venue
  -- with missing cost data look cheapest. Any `?? 0` on this field produces
  -- confidently wrong "cheapest" recommendations.
  cost_irr      bigint,
  confidence    text not null check (confidence in ('high','medium','low','unknown')),
  source        text not null,
  fetched_at    timestamptz not null default now(),
  unique (origin_lat, origin_lng, dest_lat, dest_lng, mode, departure_bucket)
);

-- ★ This table is shared across events and contains NO personal data, which
-- is exactly why it may be shared (PRD-09 AS9.2).
create index if not exists travel_measurement_fetched_at_idx on travel_measurement (fetched_at);
