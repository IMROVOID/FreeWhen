/**
 * The Neshan error-code table.
 *
 * Every documented status maps to its documented action — PRD-05 §12.3,
 * transcribed literally. The table is the whole point of this phase's
 * honesty: a provider failure must degrade PRECISELY, and "precisely" means
 * according to the provider's own documentation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NESHAN_DOCUMENTED_STATUSES,
  mapNeshanStatus,
  neshanActionRetries,
  refusalReasonFor,
} from '@/src/routing/adapters/neshan-errors';

test('every documented status maps to its documented action', () => {
  // Arrange / Act / Assert — one case per row of PRD-05 §12.3.
  assert.equal(mapNeshanStatus(400).kind, 'fix_caller');
  assert.equal(mapNeshanStatus(470).kind, 'drop_point');
  assert.equal(mapNeshanStatus(480).kind, 'log_and_degrade');
  assert.equal(mapNeshanStatus(481).kind, 'degrade_immediately');
  assert.equal(mapNeshanStatus(482).kind, 'backoff_then_degrade');
  assert.equal(mapNeshanStatus(483).kind, 'log_and_degrade');
  assert.equal(mapNeshanStatus(484).kind, 'log_and_degrade');
  assert.equal(mapNeshanStatus(485).kind, 'log_and_degrade');
  assert.equal(mapNeshanStatus(500).kind, 'retry_once_then_degrade');
});

test('the documented list has exactly nine codes, and each one is mapped', () => {
  // Arrange
  const documented = [...NESHAN_DOCUMENTED_STATUSES];

  // Act / Assert
  assert.equal(documented.length, 9);
  for (const status of documented) {
    assert.ok(mapNeshanStatus(status).kind, `status ${status} must map to an action`);
  }
});

test('a config fault is logged loudly', () => {
  // Arrange / Act / Assert
  for (const status of [480, 483, 484, 485]) {
    const action = mapNeshanStatus(status);
    assert.equal(action.kind, 'log_and_degrade');
    assert.equal(action.loud, true, `status ${status} must be loud`);
  }
});

test('only a 500 earns a retry', () => {
  // Arrange / Act / Assert
  assert.equal(neshanActionRetries(mapNeshanStatus(500)), true);

  for (const status of [400, 470, 480, 481, 482, 483, 484, 485]) {
    assert.equal(
      neshanActionRetries(mapNeshanStatus(status)),
      false,
      `status ${status} must not be retried`,
    );
  }
});

test('an undocumented status degrades rather than stalling the ladder', () => {
  // Arrange / Act / Assert
  assert.equal(mapNeshanStatus(418).kind, 'degrade_immediately');
  assert.equal(mapNeshanStatus(503).kind, 'degrade_immediately');
  assert.equal(mapNeshanStatus(200).kind, 'degrade_immediately');
});

test('the refusal reason distinguishes a quota from a rate cap from a config fault', () => {
  // Arrange / Act / Assert — the bench length depends on this.
  assert.equal(refusalReasonFor(481), 'quota');
  assert.equal(refusalReasonFor(482), 'rate');
  assert.equal(refusalReasonFor(480), 'config');
  assert.equal(refusalReasonFor(483), 'config');
  assert.equal(refusalReasonFor(484), 'config');
  assert.equal(refusalReasonFor(485), 'config');
  assert.equal(refusalReasonFor(500), 'transient');
});

test('a 481 is never retried, so an exhausted quota does not delay the fallback', () => {
  // Arrange
  const action = mapNeshanStatus(481);

  // Act / Assert
  assert.equal(action.kind, 'degrade_immediately');
  assert.equal(neshanActionRetries(action), false);
});

test('a 470 drops the point rather than the whole request', () => {
  // Arrange
  const action = mapNeshanStatus(470);

  // Act / Assert
  assert.equal(action.kind, 'drop_point');
  assert.equal(neshanActionRetries(action), false);
});
