-- migrations/020_event_invite_token.sql
-- Store plaintext invite token for authorized event participants to view and share.

alter table event add column if not exists invite_token text;
