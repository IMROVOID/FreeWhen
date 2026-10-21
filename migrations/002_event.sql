-- migrations/002_event.sql
-- Idempotent and reversible. One concern. Named for what it creates.

create table if not exists event (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null check (char_length(title) between 1 and 80),
  description         text check (char_length(description) <= 500),
  activity_type       text check (activity_type in
                        ('dinner','coffee','study','birthday','hiking','movie','games','other')),
  date_window_start   timestamptz not null,
  date_window_end     timestamptz not null,
  home_tz             text not null default 'Asia/Tehran',
  voting_deadline     timestamptz,
  status              text not null default 'DRAFT'
                        check (status in ('DRAFT','OPEN','DECIDING','CONFIRMED','PAST','CANCELLED')),
  invite_token_hash   text,                    -- sha256 of the token; plaintext NEVER stored
  invite_expires_at   timestamptz,
  created_by          uuid not null references auth.users(id) on delete cascade,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint window_ordered check (date_window_start < date_window_end),
  constraint deadline_in_window check (voting_deadline is null
                                       or voting_deadline <= date_window_end)
);

-- The invite hash is NULLABLE but uniquely indexed when present. A plain
-- unique index treats NULLs as distinct, so the partial index is what makes
-- "one live link per event" enforceable rather than aspirational.
create unique index if not exists event_invite_token_hash_key
  on event (invite_token_hash)
  where invite_token_hash is not null;

create index if not exists event_status_idx      on event (status);
create index if not exists event_created_by_idx  on event (created_by);
