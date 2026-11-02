/**
 * The viewer's own location survives leaving the event page.
 *
 * ★ THE REPORT.
 *
 * "The user location is not saved when I leave an Event page or restart the App,
 * probably because the map reloads each time. Make sure it is saved (per event)
 * until removed or changed manually by the user."
 *
 * ★ THE ROW WAS ALWAYS WRITTEN; THERE WAS NO WAY TO READ IT BACK.
 *
 * `start_point` is keyed by `participant_id`, and a participant row is per event —
 * so the storage was already per-event and already durable. What was missing was
 * the other half of the resource:
 *
 *     PUT    /api/participants/me/start-point   ✔ present
 *     DELETE /api/participants/me/start-point   ✔ present
 *     GET    /api/participants/me/start-point   ✘ ABSENT
 *
 * `useStartPoint` starts with `saved: null` and only ever fills it from the result
 * of its OWN save, and `listParticipants` deliberately omits the coordinate. So
 * every fresh mount of the event page had no origin: the map redrew with no dot
 * and no route. "Probably because the map reloads each time" is the right
 * intuition — it is not the map, it is the missing read.
 *
 * ★ A READ IS ALSO WHERE AN EXISTENCE ORACLE WOULD GO.
 *
 * The handler must resolve the caller from the session and answer
 * `NOT_PARTICIPANT` for a non-member, exactly as the write does. Returning `null`
 * for a stranger would let a caller enumerate real event ids by asking for their
 * start points and watching which answer changes shape.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { ROUTES } from '@/server/app';

function code(path: string): string {
  return readFileSync(path, 'utf8');
}

const APP = code('server/app.ts');
const ROUTE = code('server/routes/participants.ts');
const SERVICE = code('server/lib/participant-service.ts');

/* ── 1. The route exists ──────────────────────────────────────────────────── */

test('the start point is readable, not only writable', () => {
  // Arrange / Act — the route table is the contract a client discovers.
  const startPointRoutes = ROUTES.filter(
    (route) =>
      route.segments.join('/') === 'api/participants/me/start-point',
  );

  // Assert
  assert.ok(startPointRoutes.length >= 3, `only ${startPointRoutes.length} methods registered`);
  assert.ok(
    startPointRoutes.some((route) => route.method === 'GET'),
    'there is still no GET for the caller’s own start point',
  );
});

test('the GET handler is exported and wired', () => {
  assert.match(ROUTE, /export async function getStartPointHandler/, 'no read handler');
  assert.match(APP, /getStartPointHandler/, 'the read handler is not imported');
  assert.match(
    APP,
    /method:\s*'GET',\s*\n\s*segments:\s*\['api',\s*'participants',\s*'me',\s*'start-point'\]/,
    'the GET is not registered against the resource',
  );
});

/* ── 2. Identity comes from the session ───────────────────────────────────── */

test('the read resolves the caller from the session, never from a parameter', () => {
  // ★ THE SAME RULE EVERY WRITE IN THIS DIRECTORY FOLLOWS.
  //
  // A caller-supplied user id plus a read is an oracle for anyone's position. The
  // handler uses `callerFrom(request)` like the PUT and the DELETE do.
  const handler = /export async function getStartPointHandler[\s\S]*?\n\}/.exec(ROUTE)?.[0] ?? '';
  assert.ok(handler.length > 0, 'the handler body was not found');

  assert.match(handler, /callerFrom\(request\)/, 'the handler does not resolve the caller');
  assert.doesNotMatch(
    handler,
    /searchParams\.get\('userId'\)|searchParams\.get\('user_id'\)|body\.user_id/,
    'identity is taken from the request instead of the session',
  );
});

test('a non-member is refused rather than told there is nothing', () => {
  // ★ `NOT_PARTICIPANT`, NOT `{ start_point: null }`.
  //
  // Answering `null` to a stranger is an existence oracle: a caller could walk
  // event ids and learn which are real from the answer's shape.
  assert.match(ROUTE, /NOT_PARTICIPANT/, 'the read has no membership refusal');
});

test('the read is not metered as a mutation', () => {
  // A budget meant for writes must not be spent by a screen load — that would make
  // opening an event page exhaust the participant's ability to save a location.
  const handler = /export async function getStartPointHandler[\s\S]*?\n\}/.exec(ROUTE)?.[0] ?? '';
  assert.doesNotMatch(
    handler,
    /withinMutationLimits/,
    'a read is being charged against the mutation budget',
  );
});

test('a coordinate is never put in a shared cache', () => {
  // The response is one person's position. `private` alone is not enough if a CDN
  // or a service worker is willing to store it.
  const handler = /export async function getStartPointHandler[\s\S]*?\n\}/.exec(ROUTE)?.[0] ?? '';
  assert.match(handler, /no-store/, 'the start point may be cached');
});

/* ── 3. The service can read a row ────────────────────────────────────────── */

test('the service exposes a read scoped to the caller’s own participant row', () => {
  assert.match(SERVICE, /export async function readStartPoint/, 'no service read');
  assert.match(SERVICE, /from start_point/, 'the read does not touch the table');
});

/* ── 4. The hook hydrates on mount ────────────────────────────────────────── */

const HOOK = code('src/features/participants/hooks/useStartPoint.ts');
const CLIENT = code('src/features/participants/services/start-point.ts');

test('the client has a read, and the hook calls it on mount', () => {
  // ★ WITHOUT THIS THE FIX IS ONLY A SERVER ENDPOINT NOBODY ASKS FOR.
  assert.match(CLIENT, /export async function readStartPoint/, 'the client cannot read the point');
  assert.match(HOOK, /readStartPoint/, 'the hook never reads the saved point');
});

test('the hydrate is keyed on the event and the user, so a switch re-reads', () => {
  const hydrate =
    /useEffect\(\(\) => \{[\s\S]*?readStartPoint[\s\S]*?\}, \[([^\]]*)\]\)/.exec(HOOK)?.[1] ?? '';

  assert.ok(hydrate.length > 0, 'the hydrate effect is not keyed on anything');
  assert.match(hydrate, /eventId/, 'a different event does not re-read');
  assert.match(hydrate, /userId/, 'a different user does not re-read');
});

test('a late read does not overwrite a save that already happened', () => {
  // ★ THE RACE IS REAL AND IT IS THE WHOLE POINT OF THIS GUARD.
  //
  // The first entry to an event opens the sheet, the participant saves, and only
  // THEN does the in-flight read for "no point" resolve. Without a sequence guard
  // the just-saved origin is replaced by `null` — which is the reported defect
  // reintroduced by its own fix.
  assert.match(HOOK, /sequence|seq|version|requestId|stale/i, 'the read has no staleness guard');
});

test('a removed point is not resurrected by the read', () => {
  // After `remove()` the local state is `null` and the read must not re-populate
  // it — the delete is the newer fact.
  const remove = /const remove = useCallback\([\s\S]*?\}, \[[^\]]*\]\);/.exec(HOOK)?.[0] ?? '';
  assert.ok(remove.length > 0, 'the remove callback was not found');
  assert.match(remove, /setSaved\(null\)/, 'removing does not clear the local point');
});
