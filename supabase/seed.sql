-- supabase/seed.sql
-- The PRD-05 §12A fixture, reproduced exactly.
--
-- ★ TWO CONSUMERS, ONE FIXTURE.
-- The engine tests (Phase 3) and the demo (Phase 12) must use identical data
-- so the demo shows a number the tests independently verify (PRD-12 §4.2).
-- A hand-tuned seed that drifts from the fixture destroys that property.
-- `npm run db:verify-fixture` recomputes the engine's aggregates from these
-- rows and asserts them against the values published in PRD-05 §12A.
--
-- ★ Darya's `max_travel_minutes` is 45, NOT 60. That single difference is
-- what makes V1's floor 22.22 and Balanced pick V2 — the assertion the whole
-- differentiator rests on.
--
-- The travel minutes below are the PRD-05 §12A table verbatim:
--
--   |        | V1 | V2 | V3 |
--   | Ali    | 30 | 12 | 15 |   car,    D_max 60
--   | Bahar  | 20 | 40 | 48 |   transit, D_max 60
--   | Cyrus  | 22 | 38 | 50 |   transit, D_max 60
--   | Darya  | 35 | 22 | 28 |   walk,    D_max 45
--
-- The rows are re-runnable: the fixture is deleted by id first, then
-- re-inserted. The ids are fixed so the demo, the engine tests and the
-- database tests all address the same rows.

begin;

-- ─────────────────────────────────────────────────────────────
-- 0. Clear the fixture (re-runnable)
-- ─────────────────────────────────────────────────────────────
delete from vote             where id::text like '55555555-%';
delete from start_point      where id::text like '66666666-%';
delete from proposal         where id::text like '44444444-%';
delete from venue            where id::text like '33333333-%';
delete from participant      where id::text like '22222222-%';
delete from event            where id::text like '11111111-1111-1111-1111-%';
delete from auth.users       where id::text like 'aaaaaaaa-0000-4000-8000-%';

-- ─────────────────────────────────────────────────────────────
-- 1. The identity rows
-- ─────────────────────────────────────────────────────────────
-- The organizer is an ANONYMOUS user: the MVP has no account requirement
-- (PRD-01 AS1.1). The organizer is distinguished by the participant ROLE,
-- not by the presence of an account.
--
-- These come BEFORE the event, because `event.created_by` references
-- `auth.users(id)`.
insert into auth.users (id, is_anonymous, created_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', true,  now() - interval '2 days'),
  ('aaaaaaaa-0000-4000-8000-000000000002', true,  now() - interval '1 day'),
  ('aaaaaaaa-0000-4000-8000-000000000003', true,  now() - interval '1 day'),
  ('aaaaaaaa-0000-4000-8000-000000000004', true,  now() - interval '1 day');

-- ─────────────────────────────────────────────────────────────
-- 2. The event
-- ─────────────────────────────────────────────────────────────
insert into event (
  id, title, activity_type, date_window_start, date_window_end,
  voting_deadline, status, home_tz, created_by,
  invite_token_hash, invite_expires_at, is_demo
) values (
  '11111111-1111-1111-1111-111111111111',
  'شام جمعه',
  'dinner',
  '2026-08-05 09:00:00+00',
  '2026-08-09 21:00:00+00',
  '2026-08-08 18:00:00+00',
  'DECIDING',
  'Asia/Tehran',
  'aaaaaaaa-0000-4000-8000-000000000001',
  -- The sha256 of the plaintext token 'freewhen-test-invite-token'. The
  -- plaintext is never stored — only its hash (FR-8.27).
  encode(digest('freewhen-test-invite-token', 'sha256'), 'hex'),
  '2026-08-16 21:00:00+00',
  -- ★ is_demo = TRUE IS WHAT MAKES /start WORK.
  --
  -- `demo_event_summary()` (migration 016) is `security definer`, so it
  -- bypasses RLS — and `e.is_demo is true` is the ONLY predicate stopping it
  -- from reading a real event. Without this column set, the reviewer's read
  -- returns null, the page demands a sign-in, and every visit spends one of the
  -- 30/hour/IP anonymous sign-ins until a room of reviewers behind one address
  -- is locked out (PRD-18 AC-18.2.1).
  --
  -- The plaintext token for `EXPO_PUBLIC_DEMO_TOKEN` is
  -- `freewhen-test-invite-token`. It is a stable literal, not minted through
  -- the UI, so /start keeps working across restarts and reseeds.
  true
);

-- ─────────────────────────────────────────────────────────────
-- 3. The four participants
-- ─────────────────────────────────────────────────────────────
insert into participant (
  id, event_id, auth_user_id, display_name, role, is_anonymous,
  visibility, modes, has_car, max_travel_minutes, access_needs, joined_at
) values
  -- Ali: the driver. D_max 60.
  ('22222222-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000001', 'علی', 'organizer', true,
   'event', array['car'], true, 60, '{"needsStepFree": false}', now() - interval '2 days'),

  -- Bahar: transit. D_max 60.
  ('22222222-0000-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000002', 'بهار', 'member', true,
   'event', array['transit'], false, 60, '{"needsStepFree": false}', now() - interval '1 day'),

  -- Cyrus: transit. D_max 60.
  ('22222222-0000-4000-8000-000000000003',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000003', 'سیروس', 'member', true,
   'event', array['transit'], false, 60, '{"needsStepFree": false}', now() - interval '1 day'),

  -- Darya: walks. ★ D_max 45 — the whole differentiator.
  ('22222222-0000-4000-8000-000000000004',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000004', 'داریا', 'member', true,
   'event', array['walk'], false, 45, '{"needsStepFree": true}', now() - interval '1 day');

-- ─────────────────────────────────────────────────────────────
-- 4. The starting points (rounded to 2 decimals — the privacy guarantee)
-- ─────────────────────────────────────────────────────────────
insert into start_point (
  id, participant_id, lat_rounded, lng_rounded, accuracy_m, source, label
) values
  ('66666666-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001', 35.70, 51.35, 1200, 'gps_coarse', 'منطقهٔ ۲'),
  ('66666666-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000002', 35.75, 51.40, 1200, 'gps_coarse', 'منطقهٔ ۳'),
  ('66666666-0000-4000-8000-000000000003', '22222222-0000-4000-8000-000000000003', 35.72, 51.42, 1200, 'gps_coarse', 'منطقهٔ ۴'),
  ('66666666-0000-4000-8000-000000000004', '22222222-0000-4000-8000-000000000004', 35.68, 51.38, 1200, 'gps_coarse', 'منطقهٔ ۱');

-- ─────────────────────────────────────────────────────────────
-- 5. The three venues
-- ─────────────────────────────────────────────────────────────
-- The accessibility of V1 is confirmed_yes, V2 and V3 are UNKNOWN. An
-- unknown must never read as accessible (TC-11), and the default for a
-- venue with no attributes is all-three-unknown.
insert into venue (
  id, event_id, name, lat, lng, address, provider_place_id, price_level,
  opening_hours, accessibility, parking
) values
  ('33333333-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   'کافه ونک', 35.700000, 51.400000, 'تهران، خیابان ونک', 'neshan-place-1', 2,
   '{"mon": ["09:00","23:00"], "tue": ["09:00","23:00"]}',
   '{"stepFreeEntrance": "confirmed_yes", "accessibleRestroom": "unknown", "limitedWalkingSuitable": "unknown"}',
   '{"available": true}'),

  ('33333333-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
   'رستوران ایتالیایی', 35.730000, 51.430000, 'تهران، میدان ونک', 'neshan-place-2', 3,
   '{"mon": ["12:00","23:30"], "tue": ["12:00","23:30"]}',
   '{"stepFreeEntrance": "unknown", "accessibleRestroom": "unknown", "limitedWalkingSuitable": "unknown"}',
   '{"available": false}'),

  ('33333333-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
   'کافه پارک لاله', 35.650000, 51.450000, 'تهران، پارک لاله', 'neshan-place-3', 1,
   null,
   '{"stepFreeEntrance": "unknown", "accessibleRestroom": "unknown", "limitedWalkingSuitable": "unknown"}',
   null);

-- ─────────────────────────────────────────────────────────────
-- 6. The proposals
-- ─────────────────────────────────────────────────────────────
insert into proposal (
  id, event_id, created_by, type, title, notes, venue_id, start_utc, end_utc,
  is_late, status, origin
) values
  ('44444444-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   '22222222-0000-4000-8000-000000000001', 'PLACE', 'کافه ونک', null,
   '33333333-0000-4000-8000-000000000001', null, null, false, 'OPEN', 'manual'),

  ('44444444-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
   '22222222-0000-4000-8000-000000000002', 'PLACE', 'رستوران ایتالیایی', null,
   '33333333-0000-4000-8000-000000000002', null, null, false, 'OPEN', 'manual'),

  ('44444444-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
   '22222222-0000-4000-8000-000000000003', 'PLACE', 'کافه پارک لاله', null,
   '33333333-0000-4000-8000-000000000003', null, null, false, 'OPEN', 'manual');

-- ─────────────────────────────────────────────────────────────
-- 7. The votes
-- ─────────────────────────────────────────────────────────────
-- A realistic spread: the group leans to V2, which is exactly the outcome
-- the fairness engine is supposed to reach independently.
insert into vote (id, proposal_id, participant_id, value, is_dealbreaker) values
  -- V1
  ('55555555-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001', 'maybe', false),
  ('55555555-0000-4000-8000-000000000002', '44444444-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000004', 'no',    false),
  -- V2
  ('55555555-0000-4000-8000-000000000003', '44444444-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000001', 'yes',   false),
  ('55555555-0000-4000-8000-000000000004', '44444444-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000002', 'yes',   false),
  ('55555555-0000-4000-8000-000000000005', '44444444-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000003', 'yes',   false),
  ('55555555-0000-4000-8000-000000000006', '44444444-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000004', 'yes',   false),
  -- V3
  ('55555555-0000-4000-8000-000000000007', '44444444-0000-4000-8000-000000000003', '22222222-0000-4000-8000-000000000001', 'no',    false),
  ('55555555-0000-4000-8000-000000000008', '44444444-0000-4000-8000-000000000003', '22222222-0000-4000-8000-000000000004', 'maybe', false);

-- ─────────────────────────────────────────────────────────────
-- 8. The travel cache — the PRD-05 §12A minutes
-- ─────────────────────────────────────────────────────────────
-- The origin is the participant's snapped start point; the destination is
-- the venue. The 15-minute departure bucket is the PRD's 19:00 weekday slot
-- (2026-08-07 is a Friday), expressed in UTC.
--
-- `cost_irr` is NULL for the transit rows: a missing cost is UNKNOWN, never
-- free (PRD-09 §3.3).
insert into travel_measurement (
  origin_lat, origin_lng, dest_lat, dest_lng, mode, departure_bucket,
  minutes, minutes_high, distance_m, transfers, walk_minutes, wait_minutes,
  cost_irr, confidence, source
) values
  -- Ali (car) → V1 30, V2 12, V3 15
  (35.70, 51.35, 35.70000, 51.40000, 'car',    '2026-08-07 15:30:00+00', 30, 30, 6200,  null, null, null,  450000, 'high', 'neshan'),
  (35.70, 51.35, 35.73000, 51.43000, 'car',    '2026-08-07 15:30:00+00', 12, 12, 2400,  null, null, null,  180000, 'high', 'neshan'),
  (35.70, 51.35, 35.65000, 51.45000, 'car',    '2026-08-07 15:30:00+00', 15, 15, 3100,  null, null, null,  220000, 'high', 'neshan'),

  -- Bahar (transit) → V1 20, V2 40, V3 48
  (35.75, 51.40, 35.70000, 51.40000, 'transit', '2026-08-07 15:30:00+00', 20, 32, 5200, 1, 6, 9, null, 'low', 'straight_line'),
  (35.75, 51.40, 35.73000, 51.43000, 'transit', '2026-08-07 15:30:00+00', 40, 55, 8400, 2, 8, 14, null, 'low', 'straight_line'),
  (35.75, 51.40, 35.65000, 51.45000, 'transit', '2026-08-07 15:30:00+00', 48, 66, 9900, 2, 9, 17, null, 'low', 'straight_line'),

  -- Cyrus (transit) → V1 22, V2 38, V3 50
  (35.72, 51.42, 35.70000, 51.40000, 'transit', '2026-08-07 15:30:00+00', 22, 34, 5600, 1, 7, 8,  null, 'low', 'straight_line'),
  (35.72, 51.42, 35.73000, 51.43000, 'transit', '2026-08-07 15:30:00+00', 38, 52, 8100, 2, 8, 13, null, 'low', 'straight_line'),
  (35.72, 51.42, 35.65000, 51.45000, 'transit', '2026-08-07 15:30:00+00', 50, 70, 10200, 2, 9, 18, null, 'low', 'straight_line'),

  -- Darya (walk) → V1 35, V2 22, V3 28  ★ D_max 45
  (35.68, 51.38, 35.70000, 51.40000, 'walk', '2026-08-07 15:30:00+00', 35, 40, 2800, null, null, null, null, 'medium', 'neshan'),
  (35.68, 51.38, 35.73000, 51.43000, 'walk', '2026-08-07 15:30:00+00', 22, 26, 1700, null, null, null, null, 'medium', 'neshan'),
  (35.68, 51.38, 35.65000, 51.45000, 'walk', '2026-08-07 15:30:00+00', 28, 32, 2200, null, null, null, null, 'medium', 'neshan');

-- ─────────────────────────────────────────────────────────────
-- 9. The activity log
-- ─────────────────────────────────────────────────────────────
-- Enum tokens and numbers only. NEVER localised prose, and NEVER a
-- coordinate (FR-8.44).
insert into activity_log (event_id, actor_id, action, subject_type, subject_id, detail) values
  ('11111111-1111-1111-1111-111111111111', '22222222-0000-4000-8000-000000000001',
   'proposal_created', 'proposal', '44444444-0000-4000-8000-000000000001', '{"venueId": "33333333-0000-4000-8000-000000000001"}'),
  ('11111111-1111-1111-1111-111111111111', '22222222-0000-4000-8000-000000000002',
   'proposal_created', 'proposal', '44444444-0000-4000-8000-000000000002', '{"venueId": "33333333-0000-4000-8000-000000000002"}'),
  ('11111111-1111-1111-1111-111111111111', '22222222-0000-4000-8000-000000000003',
   'proposal_created', 'proposal', '44444444-0000-4000-8000-000000000003', '{"venueId": "33333333-0000-4000-8000-000000000003"}'),
  ('11111111-1111-1111-1111-111111111111', '22222222-0000-4000-8000-000000000004',
   'vote_changed', 'vote', '55555555-0000-4000-8000-000000000006', '{"from": "maybe", "to": "yes"}');

commit;
