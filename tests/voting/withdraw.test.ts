/**
 * Withdrawing a vote must actually remove it.
 *
 * ★ THE DEFECT THIS PINS.
 *
 * There was no withdraw path at ANY layer. `useVote` exposed `cast` and
 * `toggleVeto`, both of which PUT; the route is an upsert; and `castVote` has no
 * DELETE branch. So the sequence a user expects — "open the edit affordance, then
 * take the vote back" — had no implementation behind it:
 *
 *  - re-tapping the already-selected pill re-wrote the same row (`previous ===
 *    value`, no-op), and the pill stayed coloured;
 *  - there was no control that expressed "remove my vote" at all.
 *
 * The user's report was "even after taking back my vote using the edit button the
 * vote is still there and the button is coloured", which is exactly the behaviour of
 * an upsert with no removal verb.
 *
 * ★ THE OPTIMISTIC PATCH IS THE PART MOST LIKELY TO BE SUBTLY WRONG.
 *
 * Removing a vote is not the inverse of casting one. A cast moves the voter from
 * `outstanding` into a value bucket; a withdrawal must put them back into
 * `outstanding`, increment `unanswered`, decrement the value's count, and delete the
 * `myVotes` key — or the card draws no selection while the tally still counts one.
 *
 * `optimisticVote` lives in `hooks/optimistic-vote.ts` rather than in `useVote.ts`
 * precisely so this file can drive it without a React renderer or the React Native
 * runtime.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const ME = { id: 'me-id', display_name: 'Sara', role: 'member' };

/** A status payload where the caller has voted `yes` on one proposal. */
function statusWithMyYes() {
  return {
    myVotes: { 'p-1': 'yes' } as Record<string, string>,
    myDealbreakers: [] as string[],
    me: ME,
    participants: [ME],
    notifications_muted: false,
    decisions: {},
    event: { id: 'e-1', status: 'OPEN', home_tz: 'Asia/Tehran', voting_deadline: null },
    proposals: [
      {
        proposal: { id: 'p-1' },
        tally: {
          yes: 1,
          maybe: 0,
          no: 0,
          unanswered: 1,
          total: 2,
          voters: { yes: ['Sara'], maybe: [], no: [] },
          outstanding: ['Ali'],
        },
      },
    ],
  };
}

async function loadOptimistic() {
  return import('@/src/features/voting/hooks/optimistic-vote');
}

test('optimisticVote accepts a null value and clears the caller’s vote', async () => {
  // Arrange
  const { optimisticVote } = await loadOptimistic();

  // Act
  const next = optimisticVote(statusWithMyYes() as never, 'p-1', null, 'Sara');

  // Assert — the selection is gone, which is what un-colours the button.
  assert.ok(
    !('p-1' in next.myVotes),
    `the vote survived a withdrawal: ${JSON.stringify(next.myVotes)}`,
  );
});

test('a withdrawal moves the voter back into outstanding', async () => {
  // Arrange
  const { optimisticVote } = await loadOptimistic();

  // Act
  const next = optimisticVote(statusWithMyYes() as never, 'p-1', null, 'Sara');
  const tally = next.proposals[0]!.tally;

  // Assert
  assert.equal(tally.yes, 0, `yes is still ${tally.yes}`);
  assert.ok(!tally.voters.yes.includes('Sara'), 'the name is still in the yes bucket');
  assert.ok(tally.outstanding.includes('Sara'), 'the voter is not back in outstanding');
  assert.equal(tally.unanswered, 2, `unanswered is ${tally.unanswered}, expected 2`);
  assert.equal(tally.total, 2, 'the total participation changed, which it must not');
});

test('a withdrawal leaves other people’s votes alone', async () => {
  // Arrange
  const withOther = statusWithMyYes();
  withOther.proposals[0]!.tally.yes = 2;
  withOther.proposals[0]!.tally.voters.yes = ['Sara', 'Ali'];
  withOther.proposals[0]!.tally.outstanding = [];
  withOther.proposals[0]!.tally.unanswered = 0;
  withOther.proposals[0]!.tally.total = 2;

  const { optimisticVote } = await loadOptimistic();

  // Act
  const next = optimisticVote(withOther as never, 'p-1', null, 'Sara');
  const tally = next.proposals[0]!.tally;

  // Assert
  assert.equal(tally.yes, 1, 'the other voter was removed too');
  assert.deepEqual(tally.voters.yes, ['Ali'], 'the wrong name was removed');
});

test('withdrawing a vote the caller never cast is a no-op', async () => {
  // Arrange
  const none = statusWithMyYes();
  none.myVotes = {};

  const { optimisticVote } = await loadOptimistic();

  // Act
  const next = optimisticVote(none as never, 'p-1', null, 'Sara');

  // Assert — the same object, so nothing re-renders for a tap that changed nothing.
  assert.equal(next, none, 'a withdrawal of nothing produced a new payload');
});

test('the client can send a withdrawal at all', () => {
  // Arrange — the transport is the thing that did not exist.
  const api = code('src/features/voting/services/voting-api.ts');

  // Assert
  assert.ok(/deleteVote/.test(api), 'there is no client function that withdraws a vote');
  assert.ok(
    /method:\s*'DELETE'/.test(api),
    'the withdrawal is not sent as DELETE, so it would be another upsert',
  );
  assert.ok(/\/vote/.test(api), 'the withdrawal does not target the vote route');
});

test('the hook exposes a withdraw, alongside cast and toggleVeto', () => {
  // Arrange
  const hook = code('src/features/voting/hooks/useVote.ts');

  // Assert
  assert.ok(/const withdraw = useCallback/.test(hook), 'the hook has no withdraw');
  assert.ok(/withdraw,/.test(hook) || /withdraw:/.test(hook), 'withdraw is not on the result');
});

test('withdrawing clears any veto on that proposal', () => {
  // Arrange — a veto is a `no` plus a flag (documented in `useVote.ts`). Leaving the
  // flag behind would keep the venue excluded by someone who now votes for nothing.
  const hook = code('src/features/voting/hooks/useVote.ts');

  // Act
  const withdrawBody = /const withdraw = useCallback\(\s*async[\s\S]{0,1200}?\n {2}\);/.exec(hook)?.[0] ?? '';

  // Assert
  assert.ok(withdrawBody.length > 0, 'the withdraw body was not found');
  assert.ok(/myDealbreakers/.test(withdrawBody), 'the withdrawal does not touch the veto list');
});

test('the server has a vote-withdrawal route that is not the proposal one', () => {
  // Arrange — `DELETE /api/proposals/:id` already means "withdraw the PROPOSAL".
  const app = code('server/app.ts');

  // Act
  const voteRoute = /method: 'DELETE'[\s\S]{0,120}?segments: \[[^\]]*'vote'[^\]]*\]/.test(app);

  // Assert
  assert.ok(voteRoute, 'there is no DELETE route on the vote path');
});

test('the server withdrawal is scoped by identity, not by a supplied id', () => {
  // Arrange — the same rule as every other vote write: the participant is derived
  // from the caller, never from the body. See `server/sql/cast_vote.rpc.sql`.
  const routes = code('server/routes/votes.ts');
  const service = code('server/lib/vote-service.ts');

  // Act
  const handler =
    /export async function withdrawVoteHandler[\s\S]{0,3000}?\n\}/.exec(routes)?.[0] ?? '';
  const fn = /export async function withdrawVote\([\s\S]{0,3000}?\n\}/.exec(service)?.[0] ?? '';

  // Assert
  assert.ok(handler.length > 0, 'no withdrawal handler');
  assert.ok(fn.length > 0, 'no withdrawal service function');
  assert.ok(/participantIn\(/.test(fn), 'the service does not resolve the participant from the caller');
  assert.ok(/caller/.test(fn), 'the service takes no caller, so it cannot be scoped');
  assert.ok(
    !/body\.(userId|participantId|participant_id)/.test(handler),
    'the handler trusts a client-supplied participant id',
  );
  assert.ok(
    /delete from vote/i.test(fn),
    'the withdrawal does not delete the row, so the tally would keep counting it',
  );
});

test('the UI offers an explicit way to remove a vote', () => {
  // Arrange — re-tapping a selected pill is invisible as an affordance, and it was
  // the gesture the defect report described as doing nothing.
  const control = code('src/features/voting/components/VoteControl.tsx');

  // Assert
  assert.ok(/onClear\?:/.test(control), 'the vote control takes no clear handler');
  assert.ok(/onPress=\{busy \? undefined : onClear\}/.test(control), 'no control fires the clear');
  assert.ok(/voting\.clearVote/.test(control), 'the clear control has no accessible name');
});
