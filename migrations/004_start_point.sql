-- migrations/004_start_point.sql
-- Idempotent and reversible. One concern. Named for what it creates.
--
-- ★ There is NO user_id column here, and there never will be (PRD-08 §4.2).
-- The row is scoped participant_id → event_id, so deleting an event cascades
-- the location out of existence. Adding a user_id would re-create the
-- orphan-row risk the design removes.

create table if not exists start_point (
  id           uuid primary key default gen_random_uuid(),
  participant_id uuid not null unique references participant(id) on delete cascade,
  -- ★ numeric(5,2) is the privacy guarantee, not a coding convention. The
  -- database physically cannot store a third decimal. Do NOT widen it to
  -- numeric(9,6) to match `venue` — venue is a public place, this is a
  -- person's approximate area.
  lat_rounded  numeric(5,2) not null,
  lng_rounded  numeric(5,2) not null,
  accuracy_m   integer not null default 1200,
  source       text not null check (source in ('gps_coarse','manual','none')),
  -- A neighbourhood name («پارک لاله»), never a geocoded street address
  -- (FR-8.13).
  label        text check (char_length(label) <= 80),
  created_at   timestamptz not null default now(),
  constraint lat_in_iran check (lat_rounded between 25 and 40),
  constraint lng_in_iran check (lng_rounded between 44 and 64)
);

create index if not exists start_point_participant_id_idx on start_point (participant_id);
