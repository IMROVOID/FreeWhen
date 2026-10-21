-- migrations/009_comment_rsvp_activity.sql
-- Idempotent and reversible. One concern per table group. Named for what it
-- creates: the engagement, social and audit tables.

-- ─────────────────────────────────────────────────────────────
-- comment
-- ─────────────────────────────────────────────────────────────
create table if not exists comment (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null references proposal(id) on delete cascade,
  participant_id uuid not null references participant(id) on delete cascade,
  -- User-generated text. Redacted from logs like pasted text (Phase 1's
  -- FORBIDDEN_KEYS includes `body`).
  body         text not null check (char_length(body) between 1 and 300),
  created_at   timestamptz not null default now()
);

create index if not exists comment_proposal_id_created_at_idx on comment (proposal_id, created_at);
create index if not exists comment_participant_id_idx         on comment (participant_id);

-- ─────────────────────────────────────────────────────────────
-- rsvp
-- ─────────────────────────────────────────────────────────────
create table if not exists rsvp (
  -- ★ One RSVP per participant. The primary key IS the participant id, so a
  -- second RSVP is a primary-key violation rather than a silent overwrite.
  participant_id uuid primary key references participant(id) on delete cascade,
  event_id     uuid not null references event(id) on delete cascade,
  value        text not null check (value in ('going','maybe','cannot')),
  updated_at   timestamptz not null default now()
);

create index if not exists rsvp_event_id_idx on rsvp (event_id);

-- ─────────────────────────────────────────────────────────────
-- event_message — In-Room Chat
-- ─────────────────────────────────────────────────────────────
create table if not exists event_message (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references event(id) on delete cascade,
  participant_id uuid not null references participant(id) on delete cascade,
  sender_name    text not null check (char_length(sender_name) between 1 and 30),
  -- User-generated text. Redacted from logs like pasted text.
  body           text not null check (char_length(body) between 1 and 500),
  message_type   text not null default 'chat' check (message_type in ('chat','system')),
  created_at     timestamptz not null default now()
);

create index if not exists event_message_event_id_created_at_idx on event_message (event_id, created_at asc);
create index if not exists event_message_participant_id_idx     on event_message (participant_id);

-- ─────────────────────────────────────────────────────────────
-- user_group — saved frequent circles
-- ─────────────────────────────────────────────────────────────
create table if not exists user_group (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 60),
  members        jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists user_group_owner_id_idx on user_group (owner_id);

-- ─────────────────────────────────────────────────────────────
-- message_report — Apple §1.2 user-generated-content reporting
-- ─────────────────────────────────────────────────────────────
create table if not exists message_report (
  id             uuid primary key default gen_random_uuid(),
  message_id     uuid not null references event_message(id) on delete cascade,
  reporter_id    uuid not null references participant(id) on delete cascade,
  reason         text check (char_length(reason) <= 200),
  created_at     timestamptz not null default now()
);

create index if not exists message_report_message_id_idx  on message_report (message_id);
create index if not exists message_report_reporter_id_idx on message_report (reporter_id);

-- ─────────────────────────────────────────────────────────────
-- activity_log — APPEND-ONLY audit trail
-- ─────────────────────────────────────────────────────────────
create table if not exists activity_log (
  id           bigserial primary key,
  event_id     uuid not null references event(id) on delete cascade,
  actor_id     uuid references participant(id) on delete set null,
  action       text not null,          -- proposal_created | vote_changed | confirmed | reopened | ...
  subject_type text,
  subject_id   uuid,
  -- ★ NEVER contains coordinates. It holds enum tokens and numbers
  -- ({"from":"maybe","to":"yes"}), never localised prose — storing prose in
  -- an append-only trail makes the history single-language permanently.
  detail       jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists activity_log_event_id_created_at_idx on activity_log (event_id, created_at desc);
