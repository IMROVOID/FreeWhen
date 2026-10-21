-- migrations/007_vote.sql
-- Idempotent and reversible. One concern. Named for what it creates.
--
-- ★ THIS IS THE CRITICAL MIGRATION IN THE WHOLE SCHEMA.
-- Without `unique (proposal_id, participant_id)`, duplicate votes become
-- possible and the tally silently corrupts — a bug nearly invisible in a demo
-- and immediately visible in real use (PRD-09 §6). Vote changes must be an
-- UPSERT against this constraint, never read-then-write.

create table if not exists vote (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid not null references proposal(id) on delete cascade,
  participant_id uuid not null references participant(id) on delete cascade,
  value          text not null check (value in ('yes','maybe','no')),
  -- A dealbreaker is Darya's veto, not a property of the venue. It lives on
  -- the vote, not on the proposal.
  is_dealbreaker boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- ★ THE source of truth for one-vote-per-person. Upsert against this.
  unique (proposal_id, participant_id)
);

create index if not exists vote_proposal_id_idx    on vote (proposal_id);
create index if not exists vote_participant_id_idx on vote (participant_id);
