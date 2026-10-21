-- migrations/006_proposal.sql
-- Idempotent and reversible. One concern. Named for what it creates.

create table if not exists proposal (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references event(id) on delete cascade,
  created_by   uuid not null references participant(id) on delete cascade,
  type         text not null check (type in ('TIME','PLACE','TIME_AND_PLACE')),
  title        text not null check (char_length(title) between 1 and 60),
  notes        text check (char_length(notes) <= 300),
  link         text,
  venue_id     uuid references venue(id) on delete set null,
  start_utc    timestamptz,
  end_utc      timestamptz,
  is_late      boolean not null default false,      -- created after voting began
  -- ★ LEADING and ELIMINATED are NOT status values. They are derived per
  -- render (PRD-02 §3.1). Adding them to this constraint invites drift
  -- between the tally and the label.
  status       text not null default 'OPEN'
                 check (status in ('OPEN','CHOSEN','REOPENED','WITHDRAWN')),
  -- Exists so Phase 14's parser candidates can be attributed. It is not used
  -- for anything until then, but adding the column later means a migration on
  -- a live database.
  origin       text not null default 'manual'
                 check (origin in ('manual','deterministic_parse','ai_parse')),
  created_at   timestamptz not null default now(),
  constraint time_ordered check (end_utc is null or start_utc is null or end_utc > start_utc),
  constraint place_has_venue check (type = 'TIME' or venue_id is not null),
  constraint time_has_slot check (type = 'PLACE' or start_utc is not null)
);

create index if not exists proposal_event_id_status_idx on proposal (event_id, status);
create index if not exists proposal_created_by_idx     on proposal (created_by);
create index if not exists proposal_venue_id_idx       on proposal (venue_id);
