-- 019_comment_delete.sql
--
-- Deleting a per-proposal comment (Plan 14 Task 5, PRD-02 §4.3).
--
-- ★ THE DELETE POLICY WAS MISSING, NOT THE GRANT.
--
-- Migration 011 §10 wrote read and insert policies for `comment`, and granted
-- `delete` on the TABLE to `authenticated` in §2. With RLS enabled and no delete
-- policy, the grant is inert: every delete matches zero rows. The requirement
-- ("deletable by the author, deletable by the organizer") was therefore
-- unreachable from any client, and a test run as a non-superuser would have
-- proved it — which is exactly why the suite below runs under the shim role
-- rather than as the owner.
--
-- ★ ONE POLICY, TWO CALLERS.
--
-- The author deletes their own comment; the organizer deletes any comment on
-- their event. Both are the same question — "may this caller remove this row?" —
-- so they are one USING expression. Splitting them into two policies would OR
-- them anyway and give two places for a reviewer to check.
--
-- ★ THE ORGANIZER ARM IS NOT A RIGHT TO EDIT.
--
-- There is no update policy, and none is added: a comment is a record of
-- something somebody said. Removing one is moderation, which the organizer may
-- do; silently rewording one is not offered to anybody.

-- The author arm, plus the organizer arm resolved through the proposal's event.
drop policy if exists "delete own or moderated comment" on comment;
create policy "delete own or moderated comment" on comment
  for delete to authenticated
  using (
    -- The author.
    participant_id in (
      select id from public.participant where auth_user_id = auth.uid()
    )
    -- Or the organizer of the event this proposal belongs to.
    or exists (
      select 1
      from public.proposal p
      join public.participant me
        on me.event_id = p.event_id
       and me.auth_user_id = auth.uid()
      where p.id = comment.proposal_id
        and me.role = 'organizer'
    )
  );
