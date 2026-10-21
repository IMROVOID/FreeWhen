-- migrations/008_decision.sql
-- Idempotent and reversible. One concern. Named for what it creates.

create table if not exists decision (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references event(id) on delete cascade,
  axis          text not null check (axis in ('time','place')),
  -- ★ NULLABLE, and ON DELETE SET NULL.
  --
  -- The decision's SUBJECT is the proposal that was chosen. When the
  -- participant who PROPOSED it leaves the event, their proposal is
  -- cascade-deleted — and a RESTRICT here would block the leave entirely
  -- (FR-8.22), which is how a "you confirmed, so you may never leave"
  -- trap appears.
  --
  -- `SET NULL` keeps the decision, its reason and its history; only the
  -- pointer to a now-deleted proposal is cleared. A decision whose subject
  -- is gone is a decision whose subject was withdrawn — which is what
  -- actually happened.
  proposal_id   uuid references proposal(id) on delete set null,
  lens          text not null default 'balanced',
  -- ★ The reason is stored as a TEMPLATE KEY plus params, never as a rendered
  -- sentence. A stored string would freeze Persian prose and Persian digits
  -- at confirmation time, so the Decision Card could never be shown in
  -- English (PRD-05 §11.1, PRD-10 D11A). Store reason_template =
  -- 'balanced_floor' and reason_params = '{"floorMinutes":18}'; the client
  -- renders per locale.
  reason_template text not null,
  reason_params   jsonb not null default '{}'::jsonb,
  -- Attribution is to a person IN THIS EVENT, not to an auth.users row.
  --
  -- NULLABLE, and ON DELETE SET NULL, because a participant must be able to
  -- LEAVE an event (FR-8.22) even if they were the one who confirmed the
  -- decision. With NOT NULL + NO ACTION the leave would be blocked by the
  -- foreign key, and the feature would be silently unreachable.
  confirmed_by  uuid references participant(id) on delete set null,
  confirmed_at  timestamptz not null default now(),
  reopened_at   timestamptz,
  reopen_reason text
);

-- ★ The partial index is what makes "exactly one live decision per axis" true
-- while still allowing history. A plain unique (event_id, axis) would make
-- reopening impossible.
create unique index if not exists decision_event_axis_live_key
  on decision (event_id, axis)
  where reopened_at is null;

create index if not exists decision_event_id_idx on decision (event_id);

-- ★ CROSS-EVENT INTEGRITY.
--
-- The proposal and the confirmer must BOTH belong to the decision's own
-- event. Without this, a decision in event A could name a proposal from
-- event B and attribute the confirmation to somebody who is not in event A
-- at all — a decision whose subject and whose confirmer are from a
-- different event. That is a data-integrity failure and a small
-- information leak.
--
-- ★ A trigger rather than a composite foreign key.
--
-- A composite FK would be the obvious tool, but `ON DELETE SET NULL` on a
-- composite FK sets EVERY referencing column to null — including
-- `event_id`, which is NOT NULL. So the composite form cannot express
-- "the confirmer may leave, and the decision stays". The trigger can:
-- it checks both memberships and touches nothing else.
create or replace function enforce_decision_same_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- ★ Both checks apply only when the value is being SET.
  --
  -- `decision.proposal_id` is ON DELETE RESTRICT and `decision.confirmed_by`
  -- is ON DELETE SET NULL. A participant who LEAVES an event has their
  -- participant row deleted, which cascades to their proposals — and a
  -- RESTRICT on the decision's proposal would block that delete outright.
  --
  -- The trigger therefore validates a value when it is CHOSEN, not when it
  -- is being cleared by a cascade. A decision whose participant has left
  -- keeps its history: the subject and the attribution are preserved as
  -- they were, and the fact that the person has left is a separate fact.
  if new.proposal_id is not null
     and (tg_op = 'INSERT' or old.proposal_id is distinct from new.proposal_id)
     and not exists (
    select 1 from public.proposal
    where id = new.proposal_id and event_id = new.event_id
  ) then
    raise exception 'proposal % does not belong to event %',
      new.proposal_id, new.event_id
      using errcode = 'check_violation';
  end if;

  if new.confirmed_by is not null
     and (tg_op = 'INSERT' or old.confirmed_by is distinct from new.confirmed_by)
     and not exists (
    select 1 from public.participant
    where id = new.confirmed_by and event_id = new.event_id
  ) then
    raise exception 'participant % does not belong to event %',
      new.confirmed_by, new.event_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists decision_same_event_trigger on decision;
create trigger decision_same_event_trigger
  before insert or update on decision
  for each row
  execute function enforce_decision_same_event();

revoke all on function enforce_decision_same_event() from public;
grant execute on function enforce_decision_same_event() to authenticated;
